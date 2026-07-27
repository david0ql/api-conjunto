import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { AccessAudit } from './entities/access-audit.entity';
import { CreateAccessAuditDto } from './dto/create-access-audit.dto';
import { UpdateAccessAuditDto } from './dto/update-access-audit.dto';
import { ResidentVehicle } from '../resident-vehicles/entities/resident-vehicle.entity';
import { Resident } from '../residents/entities/resident.entity';
import { Visitor } from '../visitors/entities/visitor.entity';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { PaginatedResponse, paginate } from '../common/dto/paginated-response.dto';
import { periodToStartDate } from '../common/utils/period-filter';
import { normalizePlate } from '../common/utils/normalize-plate';

interface AccessFilters extends PaginationQueryDto {
  search?: string;
  type?: string;
  entryType?: string;
  entryTime?: string;
  dateFrom?: string;
  dateTo?: string;
  towerId?: string;
  apartmentId?: string;
}

export interface FrequentVisitorEntry {
  visitorId: string;
  visitor: Visitor;
  vehiclePlate: string | null;
  vehicleBrandId: string | null;
  vehicleColor: string | null;
  vehicleModel: string | null;
  entryType: string;
  visits: number;
  lastSeen: string;
}

export interface VisitorPlateEntry {
  vehiclePlate: string;
  times: number;
  firstSeen: string;
  lastAccessId: string;
}

type PlateSearchResult =
  | { kind: 'resident_vehicle'; plate: string; vehicle: ResidentVehicle; residents: Resident[] }
  | { kind: 'visitor'; plate: string; lastAccess: AccessAudit }
  | { kind: 'not_found'; plate: string };

type PlateLocationResult = {
  plate: string;
  matches: Array<
    | { kind: 'resident_vehicle'; vehicle: ResidentVehicle; residents: Resident[] }
    | { kind: 'visitor'; lastAccess: AccessAudit }
  >;
};

@Injectable()
export class AccessAuditService {
  constructor(
    @InjectRepository(AccessAudit)
    private repository: Repository<AccessAudit>,
    @InjectRepository(ResidentVehicle)
    private residentVehiclesRepository: Repository<ResidentVehicle>,
    @InjectRepository(Visitor)
    private visitorsRepository: Repository<Visitor>,
  ) {}

  async findAll(query: AccessFilters = {}): Promise<PaginatedResponse<AccessAudit>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 15;
    const qb = this.repository.createQueryBuilder('a')
      .leftJoinAndSelect('a.resident', 'resident')
      .leftJoinAndSelect('a.visitor', 'visitor')
      .leftJoinAndSelect('a.vehicle', 'vehicle')
      .leftJoinAndSelect('a.vehicleBrand', 'vehicleBrand')
      .leftJoinAndSelect('a.apartment', 'apartment')
      .leftJoinAndSelect('apartment.towerData', 'towerData')
      .leftJoinAndSelect('a.authorizedByEmployee', 'authorizedByEmployee');

    if (query.search) {
      const q = `%${query.search}%`;
      const normalizedPlate = `%${normalizePlate(query.search).replace(/\s+/g, '')}%`;
      qb.andWhere(
        `(
          visitor.name ILIKE :q
          OR visitor.last_name ILIKE :q
          OR resident.name ILIKE :q
          OR resident.last_name ILIKE :q
          OR a.vehicle_plate ILIKE :q
          OR REPLACE(COALESCE(a.vehicle_plate, ''), ' ', '') ILIKE :normalizedPlate
          OR apartment.number ILIKE :q
        )`,
        { q, normalizedPlate },
      );
    }
    if (query.type === 'visitor') {
      qb.andWhere('a.visitor_id IS NOT NULL');
    } else if (query.type === 'resident') {
      qb.andWhere('a.resident_id IS NOT NULL');
    }
    if (query.entryType) {
      qb.andWhere('a.entry_type = :entryType', { entryType: query.entryType });
    }
    if (query.entryTime) {
      const startDate = periodToStartDate(query.entryTime);
      if (startDate) qb.andWhere('a.entry_time >= :startDate', { startDate });
    }
    if (query.dateFrom) {
      qb.andWhere('a.entry_time >= :dateFrom', { dateFrom: new Date(query.dateFrom) });
    }
    if (query.dateTo) {
      qb.andWhere('a.entry_time <= :dateTo', { dateTo: new Date(query.dateTo) });
    }
    if (query.towerId) {
      qb.andWhere('apartment.tower_id = :towerId', { towerId: query.towerId });
    }
    if (query.apartmentId) {
      qb.andWhere('a.apartment_id = :apartmentId', { apartmentId: query.apartmentId });
    }

    const [data, total] = await qb.orderBy('a.entryTime', 'DESC').skip((page - 1) * limit).take(limit).getManyAndCount();
    return paginate(data, total, page, limit);
  }

  async getStats(): Promise<{ total: number; today: number; uniqueVisitorsToday: number }> {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    const [total, today, uniqueVisitorsToday] = await Promise.all([
      this.repository.count(),
      this.repository.count({
        where: { entryTime: Between(todayStart, todayEnd) },
      }),
      this.repository
        .createQueryBuilder('a')
        .select('COUNT(DISTINCT a.visitor_id)', 'cnt')
        .where('a.entry_time BETWEEN :start AND :end', { start: todayStart, end: todayEnd })
        .andWhere('a.visitor_id IS NOT NULL')
        .getRawOne<{ cnt?: string }>()
        .then((r) => parseInt(r?.cnt ?? '0', 10)),
    ]);

    return { total, today, uniqueVisitorsToday };
  }

  async findOne(id: string): Promise<AccessAudit> {
    const item = await this.repository.findOne({
      where: { id },
      relations: ['resident', 'visitor', 'vehicle', 'vehicleBrand', 'apartment', 'authorizedByEmployee'],
    });
    if (!item) throw new NotFoundException(`AccessAudit #${id} not found`);
    return item;
  }

  /**
   * Busca el vehiculo de residente comparando SIN espacios: un match exacto deja
   * fuera las placas cargadas sin normalizar ("ABC123" vs "ABC 123"), y cuando el
   * vehiculo no aparece la porteria termina registrando al residente como visita.
   */
  private findResidentVehicleByPlate(plate: string) {
    const bare = normalizePlate(plate).replace(/\s+/g, '');
    if (!bare) return Promise.resolve(null);

    return this.residentVehiclesRepository
      .createQueryBuilder('rv')
      .leftJoinAndSelect('rv.apartment', 'apartment')
      .leftJoinAndSelect('apartment.towerData', 'towerData')
      .leftJoinAndSelect('rv.vehicleBrand', 'vehicleBrand')
      .where("REPLACE(UPPER(rv.plate), ' ', '') = :bare", { bare })
      .getOne();
  }

  async searchByPlate(plate: string): Promise<PlateSearchResult> {
    const normalized = normalizePlate(plate);
    if (!normalized) return { kind: 'not_found', plate: normalized };

    const residentVehicle = await this.findResidentVehicleByPlate(normalized);

    if (residentVehicle) {
      const residents = await this.repository.manager.find(Resident, {
        where: { apartmentId: residentVehicle.apartmentId, isActive: true },
        relations: ['apartment', 'apartment.towerData', 'residentType'],
        order: { createdAt: 'DESC' },
      });

      return { kind: 'resident_vehicle', plate: normalized, vehicle: residentVehicle, residents };
    }

    const lastAccess = await this.repository
      .createQueryBuilder('a')
      .leftJoinAndSelect('a.visitor', 'visitor')
      .leftJoinAndSelect('a.vehicleBrand', 'vehicleBrand')
      .leftJoinAndSelect('a.apartment', 'apartment')
      .leftJoinAndSelect('apartment.towerData', 'towerData')
      .where("REPLACE(UPPER(a.vehicle_plate), ' ', '') = :bare", {
        bare: normalized.replace(/\s+/g, ''),
      })
      .andWhere('a.visitor_id IS NOT NULL')
      .orderBy('a.entryTime', 'DESC')
      .getOne();

    if (lastAccess) return { kind: 'visitor', plate: normalized, lastAccess };
    return { kind: 'not_found', plate: normalized };
  }

  async locatePlate(plate: string): Promise<PlateLocationResult> {
    const normalized = normalizePlate(plate);
    if (!normalized) return { plate: normalized, matches: [] };

    const matches: PlateLocationResult['matches'] = [];

    const residentVehicle = await this.findResidentVehicleByPlate(normalized);

    if (residentVehicle) {
      const residents = await this.repository.manager.find(Resident, {
        where: { apartmentId: residentVehicle.apartmentId, isActive: true },
        relations: ['apartment', 'apartment.towerData', 'residentType'],
        order: { createdAt: 'DESC' },
      });
      matches.push({ kind: 'resident_vehicle', vehicle: residentVehicle, residents });

      // El vehiculo esta registrado a un apartamento: esa es su identidad actual.
      // Los ingresos antiguos donde se registro como visita siguen en el historial
      // de auditoria, pero no se devuelven aqui: la porteria no debe verlo como
      // residente Y visitante a la vez.
      return { plate: normalized, matches };
    }

    const lastAccess = await this.repository
      .createQueryBuilder('a')
      .leftJoinAndSelect('a.visitor', 'visitor')
      .leftJoinAndSelect('a.vehicleBrand', 'vehicleBrand')
      .leftJoinAndSelect('a.apartment', 'apartment')
      .leftJoinAndSelect('apartment.towerData', 'towerData')
      .where("REPLACE(UPPER(a.vehicle_plate), ' ', '') = :bare", {
        bare: normalized.replace(/\s+/g, ''),
      })
      .andWhere('a.visitor_id IS NOT NULL')
      .orderBy('a.entryTime', 'DESC')
      .getOne();

    if (lastAccess) matches.push({ kind: 'visitor', lastAccess });

    return { plate: normalized, matches };
  }

  async create(dto: CreateAccessAuditDto, options: { visitorPhotoWasUploaded?: boolean } = {}): Promise<AccessAudit> {
    const entryType = dto.entryType ?? 'pedestrian';
    const isCarOrMoto = entryType === 'car' || entryType === 'motorcycle';
    const isTaxi = entryType === 'taxi';
    const hasVehicle = isCarOrMoto || isTaxi;

    if (!dto.visitorId && !dto.residentId) {
      throw new BadRequestException('Debe indicar visitante o residente');
    }

    if (isCarOrMoto && !dto.vehicleBrandId) {
      throw new BadRequestException('Para carro o moto debes registrar la marca');
    }

    if (hasVehicle && !dto.vehiclePlate) {
      throw new BadRequestException('Debes registrar la placa del vehículo');
    }

    const visitor = dto.visitorId
      ? await this.visitorsRepository.findOne({ where: { id: dto.visitorId } })
      : null;
    const requestedVisitorPhotoPath = dto.visitorPhotoPath?.trim() || null;
    const visitorPhotoPath = options.visitorPhotoWasUploaded
      ? requestedVisitorPhotoPath
      : (visitor?.photoPath ?? requestedVisitorPhotoPath);

    const item = this.repository.create({
      ...dto,
      entryType,
      visitorPhotoPath,
      vehicleBrandId: isCarOrMoto ? (dto.vehicleBrandId ?? null) : null,
      vehicleColor: hasVehicle ? (dto.vehicleColor?.trim() || null) : null,
      vehicleModel: hasVehicle ? (dto.vehicleModel?.trim() || null) : null,
      vehiclePlate: hasVehicle ? (normalizePlate(dto.vehiclePlate) || null) : null,
    });

    const saved = await this.repository.save(item);

    if (visitor && visitorPhotoPath && visitor.photoPath !== visitorPhotoPath) {
      visitor.photoPath = visitorPhotoPath;
      visitor.photoUpdatedAt = saved.entryTime ?? new Date();
      await this.visitorsRepository.save(visitor);
    }

    return saved;
  }

  async update(id: string, dto: UpdateAccessAuditDto): Promise<AccessAudit> {
    const item = await this.findOne(id);
    Object.assign(item, dto);
    return this.repository.save(item);
  }

  async registerExit(id: string): Promise<AccessAudit> {
    const item = await this.findOne(id);
    item.exitTime = new Date();
    return this.repository.save(item);
  }

  async findByApartment(apartmentId: string): Promise<AccessAudit[]> {
    return this.repository.find({
      where: { apartmentId },
      relations: ['resident', 'visitor', 'vehicle', 'vehicleBrand', 'apartment', 'authorizedByEmployee'],
      order: { entryTime: 'DESC' },
    });
  }

  async findPlatesByVisitor(visitorId: string): Promise<VisitorPlateEntry[]> {
    const rows: Array<{ vehicle_plate: string; times: string; first_seen: string; last_access_id: string }> =
      await this.repository
        .createQueryBuilder('a')
        .select('a.vehicle_plate', 'vehicle_plate')
        .addSelect('COUNT(*)', 'times')
        .addSelect('MIN(a.entry_time)', 'first_seen')
        .addSelect('(SELECT a2.id FROM access_audit a2 WHERE a2.visitor_id = :vid AND a2.vehicle_plate = a.vehicle_plate ORDER BY a2.entry_time DESC LIMIT 1)', 'last_access_id')
        .where('a.visitor_id = :vid', { vid: visitorId })
        .andWhere('a.vehicle_plate IS NOT NULL')
        .groupBy('a.vehicle_plate')
        .orderBy('times', 'DESC')
        .setParameter('vid', visitorId)
        .getRawMany();

    return rows.map((r) => ({
      vehiclePlate: r.vehicle_plate,
      times: parseInt(r.times, 10),
      firstSeen: r.first_seen,
      lastAccessId: r.last_access_id,
    }));
  }

  async updatePlate(id: string, vehiclePlate: string): Promise<AccessAudit> {
    const item = await this.findOne(id);
    item.vehiclePlate = normalizePlate(vehiclePlate) || null;
    return this.repository.save(item);
  }

  async findFrequentVisitors(apartmentId: string, limit = 5): Promise<FrequentVisitorEntry[]> {
    const rows: Array<{
      visitor_id: string;
      vehicle_plate: string | null;
      vehicle_brand_id: string | null;
      vehicle_color: string | null;
      vehicle_model: string | null;
      entry_type: string;
      visits: string;
      last_seen: string;
    }> = await this.repository
      .createQueryBuilder('a')
      .select('a.visitor_id', 'visitor_id')
      .addSelect('a.vehicle_plate', 'vehicle_plate')
      .addSelect('MAX(CAST(a.vehicle_brand_id AS TEXT))', 'vehicle_brand_id')
      .addSelect('MAX(a.vehicle_color)', 'vehicle_color')
      .addSelect('MAX(a.vehicle_model)', 'vehicle_model')
      .addSelect('a.entry_type', 'entry_type')
      .addSelect('COUNT(*)', 'visits')
      .addSelect('MAX(a.entry_time)', 'last_seen')
      .where('a.apartment_id = :apartmentId', { apartmentId })
      .andWhere('a.visitor_id IS NOT NULL')
      .groupBy('a.visitor_id')
      .addGroupBy('a.vehicle_plate')
      .addGroupBy('a.entry_type')
      .orderBy('visits', 'DESC')
      .limit(limit)
      .getRawMany();

    if (!rows.length) return [];

    const visitorIds = [...new Set(rows.map((r) => r.visitor_id))];
    const visitors = await this.visitorsRepository.findByIds(visitorIds);
    const visitorMap = new Map(visitors.map((v) => [v.id, v]));

    return rows
      .map((r) => {
        const visitor = visitorMap.get(r.visitor_id);
        if (!visitor) return null;
        return {
          visitorId: r.visitor_id,
          visitor,
          vehiclePlate: r.vehicle_plate,
          vehicleBrandId: r.vehicle_brand_id,
          vehicleColor: r.vehicle_color,
          vehicleModel: r.vehicle_model,
          entryType: r.entry_type,
          visits: parseInt(r.visits, 10),
          lastSeen: r.last_seen,
        };
      })
      .filter((x): x is FrequentVisitorEntry => x !== null);
  }

  async remove(id: string): Promise<void> {
    const item = await this.findOne(id);
    await this.repository.remove(item);
  }
}
