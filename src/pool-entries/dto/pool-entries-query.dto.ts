import { IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class PoolEntriesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  towerId?: string;

  @IsOptional()
  @IsUUID()
  apartmentId?: string;
}
