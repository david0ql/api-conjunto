import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { News } from './entities/news.entity';
import { CreateNewsDto } from './dto/create-news.dto';
import { UpdateNewsDto } from './dto/update-news.dto';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { PaginatedResponse, paginate } from '../common/dto/paginated-response.dto';
import { applyTokenSearch } from '../common/utils/search';
import { ResidentPushService } from '../resident-push/resident-push.service';

@Injectable()
export class NewsService {
  constructor(
    @InjectRepository(News)
    private repository: Repository<News>,
    private readonly residentPush: ResidentPushService,
  ) {}

  async findAll(query: PaginationQueryDto = {}): Promise<PaginatedResponse<News>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 15;
    const qb = this.repository
      .createQueryBuilder('news')
      .leftJoinAndSelect('news.category', 'category')
      .leftJoinAndSelect('news.createdByEmployee', 'createdByEmployee');
    applyTokenSearch(qb, query.search, [
      'news.title',
      'category.name',
      'createdByEmployee.name',
      'createdByEmployee.last_name',
    ]);
    const [data, total] = await qb
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
    const created = await this.findOne(saved.id);
    this.notifyPublished(created);
    return created;
  }

  /** News goes to every resident with the app installed. */
  private notifyPublished(news: News) {
    const content = news.content.replace(/\s+/g, ' ').trim();
    this.residentPush.notifyAllResidents({
      referenceId: news.id,
      title: news.category?.name ? `${news.category.name}: ${news.title}` : news.title,
      body: content.length > 140 ? `${content.slice(0, 139).trimEnd()}…` : content,
      notificationTypeCode: 'news_published',
    });
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
