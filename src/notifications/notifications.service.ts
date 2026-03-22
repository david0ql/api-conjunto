import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification } from './entities/notification.entity';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { UpdateNotificationDto } from './dto/update-notification.dto';
import { JwtPayload } from '../common/interfaces/jwt-payload.interface';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification)
    private repository: Repository<Notification>,
  ) {}

  async findAll(): Promise<Notification[]> {
    return this.repository.find({ relations: ['apartment', 'apartment.towerData', 'resident', 'notificationType'] });
  }

  async findOne(id: string): Promise<Notification> {
    const item = await this.repository.findOne({
      where: { id },
      relations: ['apartment', 'apartment.towerData', 'resident', 'notificationType'],
    });
    if (!item) throw new NotFoundException(`Notification #${id} not found`);
    return item;
  }

  async findOneForUser(id: string, user: JwtPayload): Promise<Notification> {
    const item = await this.findOne(id);

    if (user.type === 'resident' && item.residentId !== user.sub) {
      throw new ForbiddenException('You can only access your own notifications');
    }

    return item;
  }

  async findByResident(residentId: string): Promise<Notification[]> {
    return this.repository.find({
      where: { residentId },
      relations: ['apartment', 'apartment.towerData', 'notificationType'],
      order: { createdAt: 'DESC' },
    });
  }

  async create(dto: CreateNotificationDto): Promise<Notification> {
    const item = this.repository.create(dto);
    return this.repository.save(item);
  }

  async update(id: string, dto: UpdateNotificationDto): Promise<Notification> {
    const item = await this.findOne(id);
    Object.assign(item, dto);
    return this.repository.save(item);
  }

  async markRead(id: string, user: JwtPayload): Promise<Notification> {
    const item = await this.findOneForUser(id, user);
    item.isRead = true;
    return this.repository.save(item);
  }

  async remove(id: string): Promise<void> {
    const item = await this.findOne(id);
    await this.repository.remove(item);
  }
}
