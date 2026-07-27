import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ResidentVehicle } from './entities/resident-vehicle.entity';
import { CreateResidentVehicleDto } from './dto/create-resident-vehicle.dto';
import { UpdateResidentVehicleDto } from './dto/update-resident-vehicle.dto';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { PaginatedResponse, paginate } from '../common/dto/paginated-response.dto';
import { normalizePlate } from '../common/utils/normalize-plate';

interface VehicleFilters extends PaginationQueryDto {
  search?: string;
  apartmentId?: string;
}

@Injectable()
export class ResidentVehiclesService {
  constructor(
    @InjectRepository(ResidentVehicle)
    private repository: Repository<ResidentVehicle>,
  ) {}

  async findAll(query: VehicleFilters = {}): Promise<PaginatedResponse<ResidentVehicle>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 15;
    const qb = this.repository.createQueryBuilder('rv')
      .leftJoinAndSelect('rv.apartment', 'apartment')
      .leftJoinAndSelect('apartment.towerData', 'towerData')
      .leftJoinAndSelect('rv.vehicleBrand', 'vehicleBrand')
      .leftJoinAndSelect('rv.createdByEmployee', 'createdByEmployee');

    if (query.search) {
      const q = `%${query.search}%`;
      const normalizedPlate = `%${normalizePlate(query.search).replace(/\s+/g, '')}%`;
      qb.andWhere(
        `(
          rv.plate ILIKE :q
          OR REPLACE(COALESCE(rv.plate, ''), ' ', '') ILIKE :normalizedPlate
          OR vehicleBrand.name ILIKE :q
          OR apartment.number ILIKE :q
        )`,
        { q, normalizedPlate },
      );
    }
    if (query.apartmentId) {
      qb.andWhere('rv.apartment_id = :apartmentId', { apartmentId: query.apartmentId });
    }

    const [data, total] = await qb.orderBy('rv.createdAt', 'DESC').skip((page - 1) * limit).take(limit).getManyAndCount();
    return paginate(data, total, page, limit);
  }

  async findByApartment(apartmentId: string): Promise<ResidentVehicle[]> {
    return this.repository.find({
      where: { apartmentId },
      relations: ['vehicleBrand', 'createdByEmployee'],
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string): Promise<ResidentVehicle> {
    const item = await this.repository.findOne({
      where: { id },
      relations: ['apartment', 'apartment.towerData', 'vehicleBrand', 'createdByEmployee'],
    });
    if (!item) throw new NotFoundException(`ResidentVehicle #${id} not found`);
    return item;
  }

  async findByPlate(plate: string): Promise<ResidentVehicle | null> {
    // Se compara ignorando espacios para que "ABC123" y "ABC 123" encuentren el
    // mismo vehículo, incluidos registros antiguos guardados sin normalizar.
    const bare = normalizePlate(plate).replace(/\s+/g, '');
    if (!bare) return null;

    return this.repository
      .createQueryBuilder('rv')
      .leftJoinAndSelect('rv.apartment', 'apartment')
      .leftJoinAndSelect('apartment.towerData', 'towerData')
      .leftJoinAndSelect('rv.vehicleBrand', 'vehicleBrand')
      .where("REPLACE(UPPER(rv.plate), ' ', '') = :bare", { bare })
      .getOne();
  }

  /**
   * La placa es única en todo el conjunto. Se compara ignorando espacios para
   * detectar también registros antiguos guardados sin normalizar ("ABC123"),
   * que un índice único sobre la columna cruda no alcanzaría a emparejar.
   */
  private async assertPlateIsAvailable(
    plate: string,
    apartmentId: string,
    excludeId?: string,
  ): Promise<void> {
    const normalized = normalizePlate(plate);
    const bare = normalized.replace(/\s+/g, '');
    if (!bare) return;

    const qb = this.repository
      .createQueryBuilder('rv')
      .leftJoinAndSelect('rv.apartment', 'apartment')
      .leftJoinAndSelect('apartment.towerData', 'towerData')
      .where("REPLACE(UPPER(rv.plate), ' ', '') = :bare", { bare });

    if (excludeId) qb.andWhere('rv.id != :excludeId', { excludeId });

    const existing = await qb.getOne();
    if (!existing) return;

    if (existing.apartmentId === apartmentId) {
      throw new ConflictException(
        `La placa ${normalized} ya está registrada en este apartamento`,
      );
    }

    const tower = existing.apartment?.towerData?.name;
    const number = existing.apartment?.number;
    const location = number ? `${tower ? `${tower} · ` : ''}Apt. ${number}` : 'otro apartamento';
    throw new ConflictException(
      `La placa ${normalized} ya está registrada en ${location}`,
    );
  }

  async create(dto: CreateResidentVehicleDto, employeeId: string): Promise<ResidentVehicle> {
    await this.assertPlateIsAvailable(dto.plate, dto.apartmentId);

    const item = this.repository.create({
      ...dto,
      vehicleType: dto.vehicleType ?? 'motorcycle',
      plate: normalizePlate(dto.plate),
      color: dto.color?.trim() || null,
      model: dto.model?.trim() || null,
      notes: dto.notes?.trim() || null,
      createdByEmployeeId: employeeId,
    });
    const saved = await this.repository.save(item);
    return this.findOne(saved.id);
  }

  async update(id: string, dto: UpdateResidentVehicleDto): Promise<ResidentVehicle> {
    const item = await this.findOne(id);

    if (dto.plate) {
      await this.assertPlateIsAvailable(dto.plate, dto.apartmentId ?? item.apartmentId, id);
    }

    await this.repository.update(id, {
      apartmentId: dto.apartmentId ?? item.apartmentId,
      vehicleBrandId: dto.vehicleBrandId ?? item.vehicleBrandId,
      vehicleType: dto.vehicleType ?? item.vehicleType,
      plate: dto.plate ? normalizePlate(dto.plate) : item.plate,
      color: dto.color !== undefined ? (dto.color?.trim() || null) : item.color,
      model: dto.model !== undefined ? (dto.model?.trim() || null) : item.model,
      notes: dto.notes !== undefined ? (dto.notes?.trim() || null) : item.notes,
    });

    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    const item = await this.findOne(id);
    await this.repository.remove(item);
  }
}
