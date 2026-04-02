import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Fine } from './entities/fine.entity';
import { FineType } from './entities/fine-type.entity';
import { CreateFineTypeDto } from './dto/create-fine-type.dto';
import { UpdateFineTypeValueDto } from './dto/update-fine-type-value.dto';
import { CreateFineDto } from './dto/create-fine.dto';
import { UpdateFineDto } from './dto/update-fine.dto';
import { Apartment } from '../apartments/entities/apartment.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notification-types/entities/notification-type.entity';

@Injectable()
export class FinesService {
  private readonly logger = new Logger(FinesService.name);

  constructor(
    @InjectRepository(Fine)
    private readonly fineRepository: Repository<Fine>,
    @InjectRepository(FineType)
    private readonly fineTypeRepository: Repository<FineType>,
    @InjectRepository(Apartment)
    private readonly apartmentRepository: Repository<Apartment>,
    @InjectRepository(NotificationType)
    private readonly notificationTypeRepository: Repository<NotificationType>,
    private readonly notificationsService: NotificationsService,
  ) {}

  findFineTypes(): Promise<FineType[]> {
    return this.fineTypeRepository.find({
      relations: ['createdByEmployee'],
      order: { name: 'ASC' },
    });
  }

  async createFineType(dto: CreateFineTypeDto, employeeId: string): Promise<FineType> {
    const item = this.fineTypeRepository.create({
      name: dto.name.trim(),
      value: dto.value,
      createdByEmployeeId: employeeId,
    });

    return this.fineTypeRepository.save(item);
  }

  async updateFineTypeValue(id: string, dto: UpdateFineTypeValueDto): Promise<FineType> {
    const item = await this.findFineTypeById(id);
    item.value = dto.value;
    return this.fineTypeRepository.save(item);
  }

  findAll(): Promise<Fine[]> {
    return this.fineRepository.find({
      relations: [
        'apartment',
        'apartment.towerData',
        'resident',
        'resident.apartment',
        'resident.apartment.towerData',
        'fineType',
        'createdByEmployee',
      ],
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string): Promise<Fine> {
    const item = await this.fineRepository.findOne({
      where: { id },
      relations: [
        'apartment',
        'apartment.towerData',
        'resident',
        'resident.apartment',
        'resident.apartment.towerData',
        'fineType',
        'createdByEmployee',
      ],
    });

    if (!item) {
      throw new NotFoundException(`Fine #${id} not found`);
    }

    return item;
  }

  async create(dto: CreateFineDto, employeeId: string): Promise<Fine> {
    const fineType = await this.findFineTypeById(dto.fineTypeId);
    const apartment = await this.apartmentRepository.findOne({ where: { id: dto.apartmentId } });
    if (!apartment) {
      throw new NotFoundException(`Apartment #${dto.apartmentId} not found`);
    }
    const item = this.fineRepository.create({
      apartmentId: dto.apartmentId,
      residentId: null,
      fineTypeId: dto.fineTypeId,
      amount: dto.amount ?? fineType.value,
      notes: dto.notes?.trim() || null,
      createdByEmployeeId: employeeId,
    });

    const saved = await this.fineRepository.save(item);
    const created = await this.findOne(saved.id);
    await this.notifyResidentsForFine(created);
    return created;
  }

  async update(id: string, dto: UpdateFineDto): Promise<Fine> {
    const item = await this.findOne(id);

    if (dto.amount !== undefined) {
      item.amount = dto.amount;
    }

    if (dto.notes !== undefined) {
      item.notes = dto.notes?.trim() || null;
    }

    await this.fineRepository.save(item);
    return this.findOne(item.id);
  }

  private async findFineTypeById(id: string): Promise<FineType> {
    const item = await this.fineTypeRepository.findOne({ where: { id } });

    if (!item) {
      throw new NotFoundException(`FineType #${id} not found`);
    }

    return item;
  }

  private async notifyResidentsForFine(fine: Fine): Promise<void> {
    if (!fine.apartmentId) {
      return;
    }

    const notificationType =
      (await this.notificationTypeRepository.findOne({ where: { code: 'fine' } })) ??
      (await this.notificationTypeRepository.findOne({ where: { code: 'general' } }));

    if (!notificationType) {
      this.logger.warn(`No se encontró tipo de notificación para multa ${fine.id}`);
      return;
    }

    const amount = Number.isFinite(fine.amount)
      ? new Intl.NumberFormat('es-CO', {
          style: 'currency',
          currency: 'COP',
          maximumFractionDigits: 0,
        }).format(fine.amount)
      : `${fine.amount}`;

    const fineName = fine.fineType?.name ?? 'Multa';
    const message = fine.notes?.trim()
      ? `Se registró una multa (${fineName}) por ${amount}. Detalle: ${fine.notes.trim()}`
      : `Se registró una multa (${fineName}) por ${amount}.`;

    try {
      await this.notificationsService.create({
        apartmentId: fine.apartmentId,
        notificationTypeId: notificationType.id,
        message,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`No fue posible enviar notificación de multa ${fine.id}: ${reason}`);
    }
  }
}
