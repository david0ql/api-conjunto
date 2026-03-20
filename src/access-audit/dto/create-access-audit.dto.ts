import { IsUUID, IsOptional, IsString } from 'class-validator';

export class CreateAccessAuditDto {
  @IsUUID()
  @IsOptional()
  residentId?: string;

  @IsUUID()
  @IsOptional()
  visitorId?: string;

  @IsUUID()
  @IsOptional()
  vehicleId?: string;

  @IsUUID()
  @IsOptional()
  apartmentId?: string;

  @IsUUID()
  @IsOptional()
  authorizedByEmployeeId?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
