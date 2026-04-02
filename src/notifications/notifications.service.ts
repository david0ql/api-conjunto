import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, In, Repository } from 'typeorm';
import { Notification } from './entities/notification.entity';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { UpdateNotificationDto } from './dto/update-notification.dto';
import { JwtPayload } from '../common/interfaces/jwt-payload.interface';
import { ResidentApartment } from '../resident-apartments/entities/resident-apartment.entity';
import { Resident } from '../residents/entities/resident.entity';
import { CallsPushService } from '../calls/calls-push.service';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification)
    private repository: Repository<Notification>,
    @InjectRepository(ResidentApartment)
    private readonly residentApartmentsRepository: Repository<ResidentApartment>,
    @InjectRepository(Resident)
    private readonly residentsRepository: Repository<Resident>,
    private readonly callsPushService: CallsPushService,
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

    if (user.type === 'resident') {
      const canAccess = await this.canResidentAccessNotification(user.sub, item);
      if (!canAccess) {
        throw new ForbiddenException('You can only access your own notifications');
      }
    }

    return item;
  }

  async findByResident(residentId: string): Promise<Notification[]> {
    const apartmentIds = await this.getResidentApartmentIds(residentId);
    const query = this.repository
      .createQueryBuilder('notification')
      .leftJoinAndSelect('notification.apartment', 'apartment')
      .leftJoinAndSelect('apartment.towerData', 'tower')
      .leftJoinAndSelect('notification.notificationType', 'notificationType')
      .where('notification.residentId = :residentId', { residentId })
      .orderBy('notification.createdAt', 'DESC');

    if (apartmentIds.length > 0) {
      query.orWhere(
        new Brackets((qb) => {
          qb.where('notification.residentId IS NULL').andWhere('notification.apartmentId IN (:...apartmentIds)', {
            apartmentIds,
          });
        }),
      );
    }

    return query.getMany();
  }

  async create(dto: CreateNotificationDto): Promise<Notification> {
    const item = this.repository.create(dto);
    const saved = await this.repository.save(item);
    const created = await this.findOne(saved.id);
    const targetResidentIds = await this.resolveTargetResidentIds(created);

    if (targetResidentIds.length > 0) {
      await this.callsPushService.sendResidentNotification({
        targetResidentIds,
        notificationId: created.id,
        title: created.notificationType?.name ?? 'Nueva notificación',
        body: created.message,
        notificationTypeCode: created.notificationType?.code ?? null,
      });
    }

    return created;
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

  private async canResidentAccessNotification(residentId: string, item: Notification): Promise<boolean> {
    if (item.residentId === residentId) {
      return true;
    }

    if (item.residentId) {
      return false;
    }

    if (!item.apartmentId) {
      return false;
    }

    const apartmentIds = await this.getResidentApartmentIds(residentId);
    return apartmentIds.includes(item.apartmentId);
  }

  private async resolveTargetResidentIds(item: Notification): Promise<string[]> {
    if (item.residentId) {
      return [item.residentId];
    }

    if (!item.apartmentId) {
      return [];
    }

    const activeByApartment = await this.residentApartmentsRepository.find({
      where: { apartmentId: item.apartmentId },
      select: ['residentId'],
    });
    const fallbackResidents = await this.residentsRepository.find({
      where: { apartmentId: item.apartmentId, isActive: true },
      select: ['id'],
    });

    return Array.from(
      new Set([
        ...activeByApartment.map((row) => row.residentId),
        ...fallbackResidents.map((resident) => resident.id),
      ]),
    );
  }

  private async getResidentApartmentIds(residentId: string): Promise<string[]> {
    const links = await this.residentApartmentsRepository.find({
      where: { residentId },
      select: ['apartmentId'],
    });
    const resident = await this.residentsRepository.findOne({
      where: { id: residentId },
      select: ['apartmentId'],
    });

    return Array.from(
      new Set([
        ...links.map((row) => row.apartmentId),
        ...(resident?.apartmentId ? [resident.apartmentId] : []),
      ]),
    );
  }
}
