import { Injectable, NotFoundException } from '@nestjs/common';
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
      qb.andWhere('(rv.plate ILIKE :q OR vehicleBrand.name ILIKE :q OR apartment.number ILIKE :q)', { q });
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
    const normalized = normalizePlate(plate);
    return this.repository.findOne({
      where: { plate: normalized },
      relations: ['apartment', 'apartment.towerData', 'vehicleBrand'],
    });
  }

  async create(dto: CreateResidentVehicleDto, employeeId: string): Promise<ResidentVehicle> {
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
