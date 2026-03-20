import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SystemLog } from './entities/system-log.entity';
import { CreateSystemLogDto } from './dto/create-system-log.dto';

@Injectable()
export class SystemLogsService {
  constructor(
    @InjectRepository(SystemLog)
    private repository: Repository<SystemLog>,
  ) {}

  async findAll(): Promise<SystemLog[]> {
    return this.repository.find({ relations: ['employee'], order: { createdAt: 'DESC' } });
  }

  async findOne(id: string): Promise<SystemLog> {
    const item = await this.repository.findOne({
      where: { id },
      relations: ['employee'],
    });
    if (!item) throw new NotFoundException(`SystemLog #${id} not found`);
    return item;
  }

  async create(dto: CreateSystemLogDto): Promise<SystemLog> {
    const item = this.repository.create(dto);
    return this.repository.save(item);
  }

  async remove(id: string): Promise<void> {
    const item = await this.findOne(id);
    await this.repository.remove(item);
  }
}
