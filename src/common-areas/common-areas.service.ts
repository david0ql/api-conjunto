import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CommonArea } from './entities/common-area.entity';
import { CreateCommonAreaDto } from './dto/create-common-area.dto';
import { UpdateCommonAreaDto } from './dto/update-common-area.dto';
import { Reservation } from '../reservations/entities/reservation.entity';

@Injectable()
export class CommonAreasService {
  constructor(
    @InjectRepository(CommonArea)
    private repository: Repository<CommonArea>,
    @InjectRepository(Reservation)
    private reservationsRepository: Repository<Reservation>,
  ) {}

  async findAll(): Promise<CommonArea[]> {
    return this.repository.find({ order: { createdAt: 'DESC' } });
  }

  async findOne(id: string): Promise<CommonArea> {
    const item = await this.repository.findOne({ where: { id } });
    if (!item) throw new NotFoundException(`CommonArea #${id} not found`);
    return item;
  }

  async create(dto: CreateCommonAreaDto): Promise<CommonArea> {
    await this.ensureUniqueName(dto.name);
    const item = this.repository.create(dto);
    return this.repository.save(item);
  }

  async update(id: string, dto: UpdateCommonAreaDto): Promise<CommonArea> {
    const item = await this.findOne(id);
    if (dto.name && dto.name !== item.name) {
      await this.ensureUniqueName(dto.name, id);
    }
    Object.assign(item, dto);
    return this.repository.save(item);
  }

  async remove(id: string): Promise<void> {
    const item = await this.findOne(id);
    const reservationsCount = await this.reservationsRepository.count({ where: { areaId: id } });
    if (reservationsCount > 0) {
      throw new ConflictException('No se puede eliminar un área reservable con reservas asociadas');
    }
    await this.repository.remove(item);
  }

  private async ensureUniqueName(name: string, excludeId?: string): Promise<void> {
    const existing = await this.repository.findOne({ where: { name } });
    if (existing && existing.id !== excludeId) {
      throw new ConflictException('Ya existe un área reservable con ese nombre');
    }
  }
}
