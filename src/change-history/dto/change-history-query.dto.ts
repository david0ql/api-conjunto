import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export const CHANGE_HISTORY_ENTITY_TYPES = [
  'resident_vehicle',
  'visitor',
  'package',
  'resident',
] as const;

export class ChangeHistoryQueryDto extends PaginationQueryDto {
  @IsIn(CHANGE_HISTORY_ENTITY_TYPES)
  entityType: (typeof CHANGE_HISTORY_ENTITY_TYPES)[number];

  @IsOptional()
  @IsUUID()
  entityId?: string;
}
