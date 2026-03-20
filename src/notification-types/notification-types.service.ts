import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { NotificationType } from './entities/notification-type.entity';
import { CreateNotificationTypeDto } from './dto/create-notification-type.dto';
import { UpdateNotificationTypeDto } from './dto/update-notification-type.dto';

@Injectable()
export class NotificationTypesService {
  private readonly CACHE_TTL = 3600000;

  constructor(
    @InjectRepository(NotificationType)
    private repository: Repository<NotificationType>,
    @Inject(CACHE_MANAGER)
    private cacheManager: Cache,
  ) {}

  async findAll(): Promise<NotificationType[]> {
    const cached = await this.cacheManager.get<NotificationType[]>('notification_types');
    if (cached) return cached;
    const data = await this.repository.find();
    await this.cacheManager.set('notification_types', data, this.CACHE_TTL);
    return data;
  }

  async findOne(id: string): Promise<NotificationType> {
    const cacheKey = `notification_type_${id}`;
    const cached = await this.cacheManager.get<NotificationType>(cacheKey);
    if (cached) return cached;
    const item = await this.repository.findOne({ where: { id } });
    if (!item) throw new NotFoundException(`NotificationType #${id} not found`);
    await this.cacheManager.set(cacheKey, item, this.CACHE_TTL);
    return item;
  }

  async create(dto: CreateNotificationTypeDto): Promise<NotificationType> {
    const item = this.repository.create(dto);
    const saved = await this.repository.save(item);
    await this.cacheManager.del('notification_types');
    return saved;
  }

  async update(id: string, dto: UpdateNotificationTypeDto): Promise<NotificationType> {
    const item = await this.findOne(id);
    Object.assign(item, dto);
    const saved = await this.repository.save(item);
    await this.cacheManager.del('notification_types');
    await this.cacheManager.del(`notification_type_${id}`);
    return saved;
  }

  async remove(id: string): Promise<void> {
    const item = await this.findOne(id);
    await this.repository.remove(item);
    await this.cacheManager.del('notification_types');
    await this.cacheManager.del(`notification_type_${id}`);
  }
}
