import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PoolEntry } from './entities/pool-entry.entity';
import { CreatePoolEntryDto } from './dto/create-pool-entry.dto';
import { UpdatePoolEntryDto } from './dto/update-pool-entry.dto';

@Injectable()
export class PoolEntriesService {
  constructor(
    @InjectRepository(PoolEntry)
    private repository: Repository<PoolEntry>,
  ) {}

  async findAll(): Promise<PoolEntry[]> {
    return this.repository.find({ relations: ['resident', 'createdByEmployee'] });
  }

  async findOne(id: string): Promise<PoolEntry> {
    const item = await this.repository.findOne({
      where: { id },
      relations: ['resident', 'createdByEmployee'],
    });
    if (!item) throw new NotFoundException(`PoolEntry #${id} not found`);
    return item;
  }

  async create(dto: CreatePoolEntryDto): Promise<PoolEntry> {
    const item = this.repository.create(dto);
    return this.repository.save(item);
  }

  async update(id: string, dto: UpdatePoolEntryDto): Promise<PoolEntry> {
    const item = await this.findOne(id);
    Object.assign(item, dto);
    return this.repository.save(item);
  }

  async remove(id: string): Promise<void> {
    const item = await this.findOne(id);
    await this.repository.remove(item);
  }
}
