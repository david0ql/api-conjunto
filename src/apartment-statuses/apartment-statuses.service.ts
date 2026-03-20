import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { ApartmentStatus } from './entities/apartment-status.entity';
import { CreateApartmentStatusDto } from './dto/create-apartment-status.dto';
import { UpdateApartmentStatusDto } from './dto/update-apartment-status.dto';

@Injectable()
export class ApartmentStatusesService {
  private readonly CACHE_TTL = 3600000;

  constructor(
    @InjectRepository(ApartmentStatus)
    private repository: Repository<ApartmentStatus>,
    @Inject(CACHE_MANAGER)
    private cacheManager: Cache,
  ) {}

  async findAll(): Promise<ApartmentStatus[]> {
    const cached = await this.cacheManager.get<ApartmentStatus[]>('apartment_statuses');
    if (cached) return cached;
    const data = await this.repository.find();
    await this.cacheManager.set('apartment_statuses', data, this.CACHE_TTL);
    return data;
  }

  async findOne(id: string): Promise<ApartmentStatus> {
    const cacheKey = `apartment_status_${id}`;
    const cached = await this.cacheManager.get<ApartmentStatus>(cacheKey);
    if (cached) return cached;
    const item = await this.repository.findOne({ where: { id } });
    if (!item) throw new NotFoundException(`ApartmentStatus #${id} not found`);
    await this.cacheManager.set(cacheKey, item, this.CACHE_TTL);
    return item;
  }

  async create(dto: CreateApartmentStatusDto): Promise<ApartmentStatus> {
    const item = this.repository.create(dto);
    const saved = await this.repository.save(item);
    await this.cacheManager.del('apartment_statuses');
    return saved;
  }

  async update(id: string, dto: UpdateApartmentStatusDto): Promise<ApartmentStatus> {
    const item = await this.findOne(id);
    Object.assign(item, dto);
    const saved = await this.repository.save(item);
    await this.cacheManager.del('apartment_statuses');
    await this.cacheManager.del(`apartment_status_${id}`);
    return saved;
  }

  async remove(id: string): Promise<void> {
    const item = await this.findOne(id);
    await this.repository.remove(item);
    await this.cacheManager.del('apartment_statuses');
    await this.cacheManager.del(`apartment_status_${id}`);
  }
}
