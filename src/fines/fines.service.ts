import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Fine } from './entities/fine.entity';
import { FineType } from './entities/fine-type.entity';
import { CreateFineTypeDto } from './dto/create-fine-type.dto';
import { UpdateFineTypeValueDto } from './dto/update-fine-type-value.dto';
import { CreateFineDto } from './dto/create-fine.dto';
import { UpdateFineDto } from './dto/update-fine.dto';

@Injectable()
export class FinesService {
  constructor(
    @InjectRepository(Fine)
    private readonly fineRepository: Repository<Fine>,
    @InjectRepository(FineType)
    private readonly fineTypeRepository: Repository<FineType>,
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
    const item = this.fineRepository.create({
      residentId: dto.residentId,
      fineTypeId: dto.fineTypeId,
      amount: dto.amount ?? fineType.value,
      notes: dto.notes?.trim() || null,
      createdByEmployeeId: employeeId,
    });

    const saved = await this.fineRepository.save(item);
    return this.findOne(saved.id);
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
}
