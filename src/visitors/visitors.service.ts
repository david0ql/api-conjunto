import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Visitor } from './entities/visitor.entity';
import { CreateVisitorDto } from './dto/create-visitor.dto';
import { UpdateVisitorDto } from './dto/update-visitor.dto';
import { AccessAudit } from '../access-audit/entities/access-audit.entity';
import { PaginatedResponse, paginate } from '../common/dto/paginated-response.dto';
import { applyTokenSearch } from '../common/utils/search';

interface VisitorVisitFilters {
  towerId?: string;
  apartmentId?: string;
  /** Portero (empleado) que registró el ingreso. */
  porterId?: string;
}

interface VisitorListFilters extends VisitorVisitFilters {
  page?: number;
  limit?: number;
  search?: string;
}

/** Condiciones sobre un ingreso (access_audit con alias `alias`) según los filtros de visita. */
function visitConditions(alias: string, filters: VisitorVisitFilters) {
  const conditions: string[] = [];
  if (filters.apartmentId) conditions.push(`${alias}.apartment_id = :visitApartmentId`);
  if (filters.towerId) {
    conditions.push(`${alias}.apartment_id IN (SELECT id FROM apartments WHERE tower_id = :visitTowerId)`);
  }
  if (filters.porterId) conditions.push(`${alias}.authorized_by_employee_id = :visitPorterId`);
  return {
    conditions,
    params: {
      visitApartmentId: filters.apartmentId,
      visitTowerId: filters.towerId,
      visitPorterId: filters.porterId,
    },
  };
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

    applyTokenSearch(qb, filters.search, ['v.name', 'v.last_name', 'v.document', 'v.phone']);

    // Visitantes con al menos un ingreso que cumpla TODOS los filtros de visita.
    const visit = visitConditions('acc', filters);
    if (visit.conditions.length > 0) {
      qb.andWhere(
        `EXISTS (SELECT 1 FROM access_audit acc WHERE acc.visitor_id = v.id AND ${visit.conditions.join(' AND ')})`,
        visit.params,
      );
    }

    const [data, total] = await qb.orderBy('v.created_at', 'DESC').skip((page - 1) * limit).take(limit).getManyAndCount();
    // Con filtros, la "última visita" mostrada es la última que cumple el filtro.
    await this.applyLatestAccess(data, filters);
    return paginate(data, total, page, limit);
  }

  async findAllUnpaginated(): Promise<Visitor[]> {
    const visitors = await this.repository.find({ order: { createdAt: 'DESC' } });
    await this.applyLatestAccess(visitors);
    return visitors;
  }

  async findPorters(): Promise<Array<{ id: string; name: string; lastName: string }>> {
    return this.accessAuditRepository.manager.query(
      `SELECT e.id, e.name, e.last_name AS "lastName"
         FROM employees e
        WHERE EXISTS (
          SELECT 1 FROM access_audit a
           WHERE a.authorized_by_employee_id = e.id AND a.visitor_id IS NOT NULL
        )
        ORDER BY e.name, e.last_name`,
    );
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

  /**
   * Adjunta a cada visitante su último ingreso (cuándo, a qué torre/apartamento
   * y qué portero lo registró) y usa la foto de ese ingreso si es más reciente.
   * Una sola consulta con DISTINCT ON en vez de una por visitante.
   */
  private async applyLatestAccess(visitors: Visitor[], filters: VisitorVisitFilters = {}): Promise<void> {
    if (visitors.length === 0) return;
    const visit = visitConditions('a', filters);
    const latestQuery = this.accessAuditRepository
      .createQueryBuilder('a')
      .distinctOn(['a.visitor_id'])
      .leftJoinAndSelect('a.apartment', 'apartment')
      .leftJoinAndSelect('apartment.towerData', 'towerData')
      .leftJoinAndSelect('a.authorizedByEmployee', 'employee')
      .where('a.visitor_id IN (:...ids)', { ids: visitors.map((v) => v.id) });
    for (const condition of visit.conditions) latestQuery.andWhere(condition, visit.params);
    const latestAccesses = await latestQuery
      .orderBy('a.visitor_id')
      .addOrderBy('a.entry_time', 'DESC')
      .getMany();
    const byVisitor = new Map(latestAccesses.map((access) => [access.visitorId, access]));

    for (const visitor of visitors) {
      const access = byVisitor.get(visitor.id);
      if (!access) {
        visitor.lastAccess = null;
        continue;
      }

      visitor.lastAccess = {
        entryTime: access.entryTime,
        exitTime: access.exitTime,
        visitorCategory: access.visitorCategory,
        apartment: access.apartment
          ? {
              id: access.apartment.id,
              number: access.apartment.number,
              tower: access.apartment.towerData
                ? { id: access.apartment.towerData.id, code: access.apartment.towerData.code, name: access.apartment.towerData.name }
                : null,
            }
          : null,
        porter: access.authorizedByEmployee
          ? { id: access.authorizedByEmployee.id, name: access.authorizedByEmployee.name, lastName: access.authorizedByEmployee.lastName }
          : null,
      };

      const lastAccessPhoto = access.visitorPhotoPath?.trim();
      if (!lastAccessPhoto) continue;
      const accessIsNewer =
        visitor.photoUpdatedAt != null &&
        access.entryTime != null &&
        access.entryTime > visitor.photoUpdatedAt;
      if (!visitor.photoPath || accessIsNewer) {
        visitor.photoPath = lastAccessPhoto;
      }
    }
  }
}
