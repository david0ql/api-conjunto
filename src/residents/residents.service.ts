import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { Resident } from './entities/resident.entity';
import { CreateResidentDto } from './dto/create-resident.dto';
import { UpdateResidentDto } from './dto/update-resident.dto';

@Injectable()
export class ResidentsService {
  constructor(
    @InjectRepository(Resident)
    private repository: Repository<Resident>,
  ) {}

  async findAll(): Promise<Resident[]> {
    return this.repository.find({ relations: ['residentType'] });
  }

  async findOne(id: string): Promise<Resident> {
    const item = await this.repository.findOne({ where: { id }, relations: ['residentType'] });
    if (!item) throw new NotFoundException(`Resident #${id} not found`);
    return item;
  }

  async create(dto: CreateResidentDto): Promise<Resident> {
    const existing = await this.repository.findOne({
      where: [{ email: dto.email }, { document: dto.document }],
    });
    if (existing) throw new ConflictException('Email or document already in use');
    const passwordHash = await bcrypt.hash(dto.password, 10);
    const { password, ...rest } = dto;
    const item = this.repository.create({ ...rest, passwordHash });
    return this.repository.save(item);
  }

  async update(id: string, dto: UpdateResidentDto): Promise<Resident> {
    const item = await this.findOne(id);
    const data = dto as any;
    if (data.password) {
      (item as any).passwordHash = await bcrypt.hash(data.password, 10);
    }
    const { password: _pw, ...rest } = data;
    Object.assign(item, rest);
    return this.repository.save(item);
  }

  async remove(id: string): Promise<void> {
    const item = await this.findOne(id);
    await this.repository.remove(item);
  }

  async deactivate(id: string): Promise<Resident> {
    const item = await this.findOne(id);
    item.isActive = false;
    return this.repository.save(item);
  }
}
