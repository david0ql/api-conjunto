import { IsUUID, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreatePackageDto {
  @IsUUID()
  @IsNotEmpty()
  residentId: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsUUID()
  @IsOptional()
  createdByEmployeeId?: string;
}
