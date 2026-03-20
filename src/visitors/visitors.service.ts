import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Visitor } from './entities/visitor.entity';
import { CreateVisitorDto } from './dto/create-visitor.dto';
import { UpdateVisitorDto } from './dto/update-visitor.dto';

@Injectable()
export class VisitorsService {
  constructor(
    @InjectRepository(Visitor)
    private repository: Repository<Visitor>,
  ) {}

  async findAll(): Promise<Visitor[]> {
    return this.repository.find();
  }

  async findOne(id: string): Promise<Visitor> {
    const item = await this.repository.findOne({ where: { id } });
    if (!item) throw new NotFoundException(`Visitor #${id} not found`);
    return item;
  }

  async create(dto: CreateVisitorDto): Promise<Visitor> {
    const item = this.repository.create(dto);
    return this.repository.save(item);
  }

  async update(id: string, dto: UpdateVisitorDto): Promise<Visitor> {
    const item = await this.findOne(id);
    Object.assign(item, dto);
    return this.repository.save(item);
  }

  async remove(id: string): Promise<void> {
    const item = await this.findOne(id);
    await this.repository.remove(item);
  }
}
