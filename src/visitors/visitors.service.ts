import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Visitor } from './entities/visitor.entity';
import { CreateVisitorDto } from './dto/create-visitor.dto';
import { UpdateVisitorDto } from './dto/update-visitor.dto';
import { AccessAudit } from '../access-audit/entities/access-audit.entity';
import { PaginatedResponse, paginate } from '../common/dto/paginated-response.dto';

interface VisitorListFilters {
  page?: number;
  limit?: number;
  search?: string;
}

export interface VisitorSearchResult {
  visitor: Visitor | null;
  lastAccess: AccessAudit | null;
}

@Injectable()
export class VisitorsService {
  constructor(
    @InjectRepository(Visitor)
    private repository: Repository<Visitor>,
    @InjectRepository(AccessAudit)
    private readonly accessAuditRepository: Repository<AccessAudit>,
  ) {}

  async findAll(filters: VisitorListFilters = {}): Promise<PaginatedResponse<Visitor>> {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 15;
    const qb = this.repository.createQueryBuilder('v');

    if (filters.search) {
      const q = `%${filters.search}%`;
      qb.andWhere('(v.name ILIKE :q OR v.last_name ILIKE :q OR v.document ILIKE :q OR v.phone ILIKE :q)', { q });
    }

    const [data, total] = await qb.orderBy('v.created_at', 'DESC').skip((page - 1) * limit).take(limit).getManyAndCount();
    await this.applyLatestAccessPhotoFallback(data);
    return paginate(data, total, page, limit);
  }

  async findAllUnpaginated(): Promise<Visitor[]> {
    const visitors = await this.repository.find({ order: { createdAt: 'DESC' } });
    await this.applyLatestAccessPhotoFallback(visitors);
    return visitors;
  }

  async findOne(id: string): Promise<Visitor> {
    const item = await this.repository.findOne({ where: { id } });
    if (!item) throw new NotFoundException(`Visitor #${id} not found`);
    return item;
  }

  async findByDocumentWithLastAccess(document: string): Promise<VisitorSearchResult> {
    const normalizedDocument = document.trim();
    if (!normalizedDocument) {
      return { visitor: null, lastAccess: null };
    }

    const visitor = await this.repository.findOne({
      where: { document: normalizedDocument },
    });
    if (!visitor) {
      return { visitor: null, lastAccess: null };
    }

    const lastAccess = await this.accessAuditRepository.findOne({
      where: { visitorId: visitor.id },
      relations: ['vehicleBrand'],
      order: { entryTime: 'DESC' },
    });

    return {
      visitor,
      lastAccess: lastAccess ?? null,
    };
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

  async updatePhoto(id: string, photoPath: string): Promise<Visitor> {
    const item = await this.findOne(id);
    item.photoPath = photoPath;
    item.photoUpdatedAt = new Date();
    return this.repository.save(item);
  }

  async remove(id: string): Promise<void> {
    const item = await this.findOne(id);
    await this.repository.remove(item);
  }

  private async applyLatestAccessPhotoFallback(visitors: Visitor[]): Promise<void> {
    await Promise.all(
      visitors.map(async (visitor) => {
        const lastAccessWithPhoto = await this.accessAuditRepository.findOne({
          where: { visitorId: visitor.id },
          order: { entryTime: 'DESC' },
        });
        if (!lastAccessWithPhoto?.visitorPhotoPath?.trim()) return;
        const lastAccessPhoto = lastAccessWithPhoto.visitorPhotoPath.trim();

        const accessIsNewer =
          visitor.photoUpdatedAt != null &&
          lastAccessWithPhoto.entryTime != null &&
          lastAccessWithPhoto.entryTime > visitor.photoUpdatedAt;

        if (!visitor.photoPath || accessIsNewer) {
          visitor.photoPath = lastAccessPhoto;
        }
      }),
    );
  }
}
