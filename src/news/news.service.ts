import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { News } from './entities/news.entity';
import { CreateNewsDto } from './dto/create-news.dto';
import { UpdateNewsDto } from './dto/update-news.dto';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { PaginatedResponse, paginate } from '../common/dto/paginated-response.dto';

@Injectable()
export class NewsService {
  constructor(
    @InjectRepository(News)
    private repository: Repository<News>,
  ) {}

  async findAll(query: PaginationQueryDto = {}): Promise<PaginatedResponse<News>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 15;
    const [data, total] = await this.repository
      .createQueryBuilder('news')
      .leftJoinAndSelect('news.category', 'category')
      .leftJoinAndSelect('news.createdByEmployee', 'createdByEmployee')
      .orderBy('news.publishedAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();
    return paginate(data, total, page, limit);
  }

  async findOne(id: string): Promise<News> {
    const item = await this.repository.findOne({
      where: { id },
      relations: ['category', 'createdByEmployee'],
    });
    if (!item) throw new NotFoundException(`News #${id} not found`);
    return item;
  }

  async create(dto: CreateNewsDto): Promise<News> {
    const item = this.repository.create(dto);
    const saved = await this.repository.save(item);
    return this.findOne(saved.id);
  }

  async update(id: string, dto: UpdateNewsDto): Promise<News> {
    await this.findOne(id);
    await this.repository.update(id, dto);
    return this.findOne(id);
  }

  async updateImageUrl(id: string, imageUrl: string): Promise<News> {
    await this.findOne(id);
    await this.repository.update(id, { imageUrl });
    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    await this.repository.delete(id);
  }
}
