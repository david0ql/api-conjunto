import { IsOptional, IsDateString, IsString } from 'class-validator';

export class UpdateAccessAuditDto {
  @IsDateString()
  @IsOptional()
  exitTime?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
