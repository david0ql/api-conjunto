import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  PaginatedResponse,
  paginate,
} from '../common/dto/paginated-response.dto';
import { applyTokenSearch } from '../common/utils/search';
import { ChangeLog } from './entities/change-log.entity';
import { ChangeHistoryQueryDto } from './dto/change-history-query.dto';

@Injectable()
export class ChangeHistoryService {
  constructor(
    @InjectRepository(ChangeLog)
    private readonly repository: Repository<ChangeLog>,
  ) {}

  async findAll(
    query: ChangeHistoryQueryDto,
  ): Promise<PaginatedResponse<ChangeLog>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 15;
    const qb = this.repository
      .createQueryBuilder('log')
      .where('log.entity_type = :entityType', { entityType: query.entityType });

    if (query.entityId) {
      qb.andWhere('log.entity_id = :entityId', { entityId: query.entityId });
    }
    // Busca por el registro (placa, nombre...), por quién hizo el cambio o por
    // cualquier valor anterior/nuevo ("ABC 123", "Torre 4"...).
    applyTokenSearch(qb, query.search, [
      'log.entity_label',
      'log.actor_name',
      'log.reason',
      'log.changes::text',
    ]);

    const [data, total] = await qb
      .orderBy('log.created_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();
    return paginate(data, total, page, limit);
  }
}
