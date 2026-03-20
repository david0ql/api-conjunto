import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { ReservationStatus } from './entities/reservation-status.entity';
import { CreateReservationStatusDto } from './dto/create-reservation-status.dto';
import { UpdateReservationStatusDto } from './dto/update-reservation-status.dto';

@Injectable()
export class ReservationStatusesService {
  private readonly CACHE_TTL = 3600000;

  constructor(
    @InjectRepository(ReservationStatus)
    private repository: Repository<ReservationStatus>,
    @Inject(CACHE_MANAGER)
    private cacheManager: Cache,
  ) {}

  async findAll(): Promise<ReservationStatus[]> {
    const cached = await this.cacheManager.get<ReservationStatus[]>('reservation_statuses');
    if (cached) return cached;
    const data = await this.repository.find();
    await this.cacheManager.set('reservation_statuses', data, this.CACHE_TTL);
    return data;
  }

  async findOne(id: string): Promise<ReservationStatus> {
    const cacheKey = `reservation_status_${id}`;
    const cached = await this.cacheManager.get<ReservationStatus>(cacheKey);
    if (cached) return cached;
    const item = await this.repository.findOne({ where: { id } });
    if (!item) throw new NotFoundException(`ReservationStatus #${id} not found`);
    await this.cacheManager.set(cacheKey, item, this.CACHE_TTL);
    return item;
  }

  async create(dto: CreateReservationStatusDto): Promise<ReservationStatus> {
    const item = this.repository.create(dto);
    const saved = await this.repository.save(item);
    await this.cacheManager.del('reservation_statuses');
    return saved;
  }

  async update(id: string, dto: UpdateReservationStatusDto): Promise<ReservationStatus> {
    const item = await this.findOne(id);
    Object.assign(item, dto);
    const saved = await this.repository.save(item);
    await this.cacheManager.del('reservation_statuses');
    await this.cacheManager.del(`reservation_status_${id}`);
    return saved;
  }

  async remove(id: string): Promise<void> {
    const item = await this.findOne(id);
    await this.repository.remove(item);
    await this.cacheManager.del('reservation_statuses');
    await this.cacheManager.del(`reservation_status_${id}`);
  }
}
