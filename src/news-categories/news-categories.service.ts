import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NewsCategory } from './entities/news-category.entity';
import { CreateNewsCategoryDto } from './dto/create-news-category.dto';
import { UpdateNewsCategoryDto } from './dto/update-news-category.dto';

@Injectable()
export class NewsCategoriesService {
  constructor(
    @InjectRepository(NewsCategory)
    private repository: Repository<NewsCategory>,
  ) {}

  findAll(): Promise<NewsCategory[]> {
    return this.repository.find({ order: { name: 'ASC' } });
  }

  findActive(): Promise<NewsCategory[]> {
    return this.repository.find({ where: { isActive: true }, order: { name: 'ASC' } });
  }

  async findOne(id: string): Promise<NewsCategory> {
    const item = await this.repository.findOne({ where: { id } });
    if (!item) throw new NotFoundException(`NewsCategory #${id} not found`);
    return item;
  }

  async create(dto: CreateNewsCategoryDto): Promise<NewsCategory> {
    const item = this.repository.create(dto);
    return this.repository.save(item);
  }

  async update(id: string, dto: UpdateNewsCategoryDto): Promise<NewsCategory> {
    await this.findOne(id);
    await this.repository.update(id, dto);
    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    await this.repository.delete(id);
  }
}
