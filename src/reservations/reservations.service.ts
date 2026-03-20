import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Reservation } from './entities/reservation.entity';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { UpdateReservationDto } from './dto/update-reservation.dto';
import { ReservationStatus } from '../reservation-statuses/entities/reservation-status.entity';
import { JwtPayload } from '../common/interfaces/jwt-payload.interface';

@Injectable()
export class ReservationsService {
  constructor(
    @InjectRepository(Reservation)
    private repository: Repository<Reservation>,
    @InjectRepository(ReservationStatus)
    private reservationStatusesRepository: Repository<ReservationStatus>,
  ) {}

  async findAll(): Promise<Reservation[]> {
    return this.repository.find({ relations: ['resident', 'area', 'status'] });
  }

  async findOne(id: string): Promise<Reservation> {
    const item = await this.repository.findOne({
      where: { id },
      relations: ['resident', 'area', 'status'],
    });
    if (!item) throw new NotFoundException(`Reservation #${id} not found`);
    return item;
  }

  async findOneForUser(id: string, user: JwtPayload): Promise<Reservation> {
    const item = await this.findOne(id);

    if (user.type === 'resident' && item.residentId !== user.sub) {
      throw new ForbiddenException('You can only access your own reservations');
    }

    return item;
  }

  async findByResident(residentId: string): Promise<Reservation[]> {
    return this.repository.find({
      where: { residentId },
      relations: ['area', 'status'],
    });
  }

  async createForUser(dto: CreateReservationDto, user: JwtPayload): Promise<Reservation> {
    if (user.type === 'resident') {
      const pendingStatus = await this.reservationStatusesRepository.findOne({
        where: { code: 'pending' },
      });

      if (!pendingStatus) {
        throw new NotFoundException('Pending reservation status not configured');
      }

      const item = this.repository.create({
        residentId: user.sub,
        areaId: dto.areaId,
        reservationDate: dto.reservationDate,
        startTime: dto.startTime,
        endTime: dto.endTime,
        notesByResident: dto.notesByResident,
        statusId: pendingStatus.id,
      });

      return this.repository.save(item);
    }

    if (user.role !== 'administrator') {
      throw new ForbiddenException('Only administrators can create reservations for others');
    }

    const item = this.repository.create(dto);
    return this.repository.save(item);
  }

  async updateForUser(id: string, dto: UpdateReservationDto, user: JwtPayload): Promise<Reservation> {
    const item = await this.findOne(id);

    if (user.type === 'resident') {
      if (item.residentId !== user.sub) {
        throw new ForbiddenException('You can only update your own reservations');
      }

      item.areaId = dto.areaId ?? item.areaId;
      item.reservationDate = dto.reservationDate ?? item.reservationDate;
      item.startTime = dto.startTime ?? item.startTime;
      item.endTime = dto.endTime ?? item.endTime;
      item.notesByResident = dto.notesByResident ?? item.notesByResident;
      return this.repository.save(item);
    }

    if (user.role !== 'administrator') {
      throw new ForbiddenException('Only administrators can update reservations');
    }

    Object.assign(item, dto);
    return this.repository.save(item);
  }

  async updateStatus(id: string, statusId: string, notesByAdministrator?: string): Promise<Reservation> {
    await this.findOne(id); // throws 404 if not found
    const updateData: Partial<Reservation> = { statusId };
    if (notesByAdministrator !== undefined) updateData.notesByAdministrator = notesByAdministrator;
    await this.repository.update(id, updateData);
    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    const item = await this.findOne(id);
    await this.repository.remove(item);
  }
}
