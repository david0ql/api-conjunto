import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CommunitySpace } from './entities/community-space.entity';
import { CreateCommunitySpaceDto } from './dto/create-community-space.dto';
import { UpdateCommunitySpaceDto } from './dto/update-community-space.dto';

@Injectable()
export class CommunitySpacesService {
  constructor(
    @InjectRepository(CommunitySpace)
    private repository: Repository<CommunitySpace>,
  ) {}

  findAll(): Promise<CommunitySpace[]> {
    return this.repository.find({ order: { phase: 'ASC', name: 'ASC' } });
  }

  async findOne(id: string): Promise<CommunitySpace> {
    const item = await this.repository.findOne({ where: { id } });
    if (!item) throw new NotFoundException(`CommunitySpace #${id} not found`);
    return item;
  }

  create(dto: CreateCommunitySpaceDto): Promise<CommunitySpace> {
    return this.repository.save(this.repository.create(dto));
  }

  async update(id: string, dto: UpdateCommunitySpaceDto): Promise<CommunitySpace> {
    const item = await this.findOne(id);
    Object.assign(item, dto);
    return this.repository.save(item);
  }

  async remove(id: string): Promise<void> {
    const item = await this.findOne(id);
    await this.repository.remove(item);
  }
}
