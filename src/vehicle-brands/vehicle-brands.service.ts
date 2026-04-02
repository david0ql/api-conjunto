import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { VehicleBrand } from './entities/vehicle-brand.entity';
import { CreateVehicleBrandDto } from './dto/create-vehicle-brand.dto';

@Injectable()
export class VehicleBrandsService {
  constructor(
    @InjectRepository(VehicleBrand)
    private readonly repository: Repository<VehicleBrand>,
  ) {}

  findAll() {
    return this.repository.find({ order: { name: 'ASC' } });
  }

  async create(dto: CreateVehicleBrandDto) {
    const normalized = dto.name.trim();
    const item = this.repository.create({ name: normalized });
    return this.repository.save(item);
  }
}
