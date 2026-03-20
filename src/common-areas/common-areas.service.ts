import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CommonArea } from './entities/common-area.entity';
import { CreateCommonAreaDto } from './dto/create-common-area.dto';
import { UpdateCommonAreaDto } from './dto/update-common-area.dto';

@Injectable()
export class CommonAreasService {
  constructor(
    @InjectRepository(CommonArea)
    private repository: Repository<CommonArea>,
  ) {}

  async findAll(): Promise<CommonArea[]> {
    return this.repository.find();
  }

  async findOne(id: string): Promise<CommonArea> {
    const item = await this.repository.findOne({ where: { id } });
    if (!item) throw new NotFoundException(`CommonArea #${id} not found`);
    return item;
  }

  async create(dto: CreateCommonAreaDto): Promise<CommonArea> {
    const item = this.repository.create(dto);
    return this.repository.save(item);
  }

  async update(id: string, dto: UpdateCommonAreaDto): Promise<CommonArea> {
    const item = await this.findOne(id);
    Object.assign(item, dto);
    return this.repository.save(item);
  }

  async remove(id: string): Promise<void> {
    const item = await this.findOne(id);
    await this.repository.remove(item);
  }
}
