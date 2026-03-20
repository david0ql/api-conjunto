import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Reservation } from './entities/reservation.entity';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { UpdateReservationDto } from './dto/update-reservation.dto';

@Injectable()
export class ReservationsService {
  constructor(
    @InjectRepository(Reservation)
    private repository: Repository<Reservation>,
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

  async findByResident(residentId: string): Promise<Reservation[]> {
    return this.repository.find({
      where: { residentId },
      relations: ['area', 'status'],
    });
  }

  async create(dto: CreateReservationDto): Promise<Reservation> {
    const item = this.repository.create(dto);
    return this.repository.save(item);
  }

  async update(id: string, dto: UpdateReservationDto): Promise<Reservation> {
    const item = await this.findOne(id);
    Object.assign(item, dto);
    return this.repository.save(item);
  }

  async updateStatus(id: string, statusId: string, notes?: string): Promise<Reservation> {
    const item = await this.findOne(id);
    item.statusId = statusId;
    if (notes !== undefined) {
      item.notesByAdministrator = notes;
    }
    return this.repository.save(item);
  }

  async remove(id: string): Promise<void> {
    const item = await this.findOne(id);
    await this.repository.remove(item);
  }
}
