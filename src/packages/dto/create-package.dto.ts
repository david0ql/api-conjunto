import { IsUUID, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreatePackageDto {
  @IsUUID()
  @IsNotEmpty()
  apartmentId: string;

  @IsUUID()
  @IsOptional()
  residentId?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsUUID()
  @IsOptional()
  createdByEmployeeId?: string;
}
