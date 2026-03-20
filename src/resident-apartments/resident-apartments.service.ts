import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ResidentApartment } from './entities/resident-apartment.entity';
import { CreateResidentApartmentDto } from './dto/create-resident-apartment.dto';
import { UpdateResidentApartmentDto } from './dto/update-resident-apartment.dto';

@Injectable()
export class ResidentApartmentsService {
  constructor(
    @InjectRepository(ResidentApartment)
    private repository: Repository<ResidentApartment>,
  ) {}

  async findAll(): Promise<ResidentApartment[]> {
    return this.repository.find({ relations: ['resident', 'apartment'] });
  }

  async findOne(id: string): Promise<ResidentApartment> {
    const item = await this.repository.findOne({
      where: { id },
      relations: ['resident', 'apartment'],
    });
    if (!item) throw new NotFoundException(`ResidentApartment #${id} not found`);
    return item;
  }

  async findByResident(residentId: string): Promise<ResidentApartment[]> {
    return this.repository.find({
      where: { residentId },
      relations: ['apartment'],
    });
  }

  async findByApartment(apartmentId: string): Promise<ResidentApartment[]> {
    return this.repository.find({
      where: { apartmentId },
      relations: ['resident'],
    });
  }

  async create(dto: CreateResidentApartmentDto): Promise<ResidentApartment> {
    const item = this.repository.create(dto);
    return this.repository.save(item);
  }

  async update(id: string, dto: UpdateResidentApartmentDto): Promise<ResidentApartment> {
    const item = await this.findOne(id);
    Object.assign(item, dto);
    return this.repository.save(item);
  }

  async remove(id: string): Promise<void> {
    const item = await this.findOne(id);
    await this.repository.remove(item);
  }
}
