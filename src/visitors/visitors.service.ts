import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Visitor } from './entities/visitor.entity';
import { CreateVisitorDto } from './dto/create-visitor.dto';
import { UpdateVisitorDto } from './dto/update-visitor.dto';
import { AccessAudit } from '../access-audit/entities/access-audit.entity';

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

  async findAll(): Promise<Visitor[]> {
    return this.repository.find();
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

  async remove(id: string): Promise<void> {
    const item = await this.findOne(id);
    await this.repository.remove(item);
  }
}
