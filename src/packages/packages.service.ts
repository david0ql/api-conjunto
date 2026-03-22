import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Package } from './entities/package.entity';
import { CreatePackageDto } from './dto/create-package.dto';
import { UpdatePackageDto } from './dto/update-package.dto';

@Injectable()
export class PackagesService {
  constructor(
    @InjectRepository(Package)
    private repository: Repository<Package>,
  ) {}

  async findAll(): Promise<Package[]> {
    return this.repository.find({ relations: ['apartment', 'apartment.towerData', 'resident', 'createdByEmployee', 'receivedByResident'] });
  }

  async findOne(id: string): Promise<Package> {
    const item = await this.repository.findOne({
      where: { id },
      relations: ['apartment', 'apartment.towerData', 'resident', 'createdByEmployee', 'receivedByResident'],
    });
    if (!item) throw new NotFoundException(`Package #${id} not found`);
    return item;
  }

  async findByResident(residentId: string): Promise<Package[]> {
    return this.repository.find({
      where: { residentId },
      relations: ['apartment', 'apartment.towerData', 'createdByEmployee'],
    });
  }

  async create(dto: CreatePackageDto): Promise<Package> {
    const item = this.repository.create(dto);
    return this.repository.save(item);
  }

  async update(id: string, dto: UpdatePackageDto): Promise<Package> {
    const item = await this.findOne(id);
    Object.assign(item, dto);
    return this.repository.save(item);
  }

  async markDelivered(id: string, dto: UpdatePackageDto): Promise<Package> {
    const item = await this.findOne(id);
    item.delivered = true;
    item.deliveredTime = new Date();
    if (dto.receivedByResidentId) {
      item.receivedByResidentId = dto.receivedByResidentId;
    }
    return this.repository.save(item);
  }

  async remove(id: string): Promise<void> {
    const item = await this.findOne(id);
    await this.repository.remove(item);
  }
}
