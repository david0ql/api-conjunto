import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Vehicle } from './entities/vehicle.entity';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';

@Injectable()
export class VehiclesService {
  constructor(
    @InjectRepository(Vehicle)
    private repository: Repository<Vehicle>,
  ) {}

  async findAll(): Promise<Vehicle[]> {
    return this.repository.find({ relations: ['vehicleType', 'resident'] });
  }

  async findOne(id: string): Promise<Vehicle> {
    const item = await this.repository.findOne({
      where: { id },
      relations: ['vehicleType', 'resident'],
    });
    if (!item) throw new NotFoundException(`Vehicle #${id} not found`);
    return item;
  }

  async create(dto: CreateVehicleDto): Promise<Vehicle> {
    const item = this.repository.create(dto);
    return this.repository.save(item);
  }

  async update(id: string, dto: UpdateVehicleDto): Promise<Vehicle> {
    const item = await this.findOne(id);
    Object.assign(item, dto);
    return this.repository.save(item);
  }

  async remove(id: string): Promise<void> {
    const item = await this.findOne(id);
    await this.repository.remove(item);
  }

  async deactivate(id: string): Promise<Vehicle> {
    const item = await this.findOne(id);
    item.isActive = false;
    return this.repository.save(item);
  }
}
