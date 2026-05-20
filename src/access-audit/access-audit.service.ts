import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { AccessAudit } from './entities/access-audit.entity';
import { CreateAccessAuditDto } from './dto/create-access-audit.dto';
import { UpdateAccessAuditDto } from './dto/update-access-audit.dto';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { PaginatedResponse, paginate } from '../common/dto/paginated-response.dto';
import { periodToStartDate } from '../common/utils/period-filter';
import { normalizePlate } from '../common/utils/normalize-plate';

interface AccessFilters extends PaginationQueryDto {
  search?: string;
  type?: string;
  entryType?: string;
  entryTime?: string;
  towerId?: string;
  apartmentId?: string;
}

@Injectable()
export class AccessAuditService {
  constructor(
    @InjectRepository(AccessAudit)
    private repository: Repository<AccessAudit>,
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
      qb.andWhere('(visitor.name ILIKE :q OR visitor.last_name ILIKE :q OR resident.name ILIKE :q OR resident.last_name ILIKE :q OR a.vehicle_plate ILIKE :q OR apartment.number ILIKE :q)', { q });
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
        .getRawOne()
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

  async create(dto: CreateAccessAuditDto): Promise<AccessAudit> {
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

    const item = this.repository.create({
      ...dto,
      entryType,
      vehicleBrandId: isCarOrMoto ? (dto.vehicleBrandId ?? null) : null,
      vehicleColor: hasVehicle ? (dto.vehicleColor?.trim() || null) : null,
      vehicleModel: hasVehicle ? (dto.vehicleModel?.trim() || null) : null,
      vehiclePlate: hasVehicle ? (normalizePlate(dto.vehiclePlate) || null) : null,
    });

    return this.repository.save(item);
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

  async remove(id: string): Promise<void> {
    const item = await this.findOne(id);
    await this.repository.remove(item);
  }
}
