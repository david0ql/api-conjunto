import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { VehicleType } from './entities/vehicle-type.entity';
import { CreateVehicleTypeDto } from './dto/create-vehicle-type.dto';
import { UpdateVehicleTypeDto } from './dto/update-vehicle-type.dto';

@Injectable()
export class VehicleTypesService {
  private readonly CACHE_TTL = 3600000;

  constructor(
    @InjectRepository(VehicleType)
    private repository: Repository<VehicleType>,
    @Inject(CACHE_MANAGER)
    private cacheManager: Cache,
  ) {}

  async findAll(): Promise<VehicleType[]> {
    const cached = await this.cacheManager.get<VehicleType[]>('vehicle_types');
    if (cached) return cached;
    const data = await this.repository.find();
    await this.cacheManager.set('vehicle_types', data, this.CACHE_TTL);
    return data;
  }

  async findOne(id: string): Promise<VehicleType> {
    const cacheKey = `vehicle_type_${id}`;
    const cached = await this.cacheManager.get<VehicleType>(cacheKey);
    if (cached) return cached;
    const item = await this.repository.findOne({ where: { id } });
    if (!item) throw new NotFoundException(`VehicleType #${id} not found`);
    await this.cacheManager.set(cacheKey, item, this.CACHE_TTL);
    return item;
  }

  async create(dto: CreateVehicleTypeDto): Promise<VehicleType> {
    const item = this.repository.create(dto);
    const saved = await this.repository.save(item);
    await this.cacheManager.del('vehicle_types');
    return saved;
  }

  async update(id: string, dto: UpdateVehicleTypeDto): Promise<VehicleType> {
    const item = await this.findOne(id);
    Object.assign(item, dto);
    const saved = await this.repository.save(item);
    await this.cacheManager.del('vehicle_types');
    await this.cacheManager.del(`vehicle_type_${id}`);
    return saved;
  }

  async remove(id: string): Promise<void> {
    const item = await this.findOne(id);
    await this.repository.remove(item);
    await this.cacheManager.del('vehicle_types');
    await this.cacheManager.del(`vehicle_type_${id}`);
  }
}
