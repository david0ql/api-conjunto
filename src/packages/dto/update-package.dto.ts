import { IsBoolean, IsOptional, IsUUID } from 'class-validator';

export class UpdatePackageDto {
  @IsBoolean()
  @IsOptional()
  delivered?: boolean;

  @IsUUID()
  @IsOptional()
  receivedByResidentId?: string;
}
