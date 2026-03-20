import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Apartment } from './entities/apartment.entity';
import { CreateApartmentDto } from './dto/create-apartment.dto';
import { UpdateApartmentDto } from './dto/update-apartment.dto';

@Injectable()
export class ApartmentsService {
  constructor(
    @InjectRepository(Apartment)
    private repository: Repository<Apartment>,
  ) {}

  async findAll(): Promise<Apartment[]> {
    return this.repository.find({ relations: ['status'] });
  }

  async findOne(id: string): Promise<Apartment> {
    const item = await this.repository.findOne({ where: { id }, relations: ['status'] });
    if (!item) throw new NotFoundException(`Apartment #${id} not found`);
    return item;
  }

  async create(dto: CreateApartmentDto): Promise<Apartment> {
    const item = this.repository.create(dto);
    return this.repository.save(item);
  }

  async update(id: string, dto: UpdateApartmentDto): Promise<Apartment> {
    const item = await this.findOne(id);
    Object.assign(item, dto);
    return this.repository.save(item);
  }

  async remove(id: string): Promise<void> {
    const item = await this.findOne(id);
    await this.repository.remove(item);
  }
}
