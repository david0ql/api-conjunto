import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { ACCESS_ENTRY_TYPES, type AccessEntryType } from '../entities/access-audit.entity';

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

  @IsIn(ACCESS_ENTRY_TYPES)
  @IsOptional()
  entryType?: AccessEntryType;

  @IsUUID()
  @IsOptional()
  vehicleBrandId?: string;

  @IsString()
  @MaxLength(40)
  @IsOptional()
  vehicleColor?: string;

  @IsString()
  @MaxLength(15)
  @IsOptional()
  vehiclePlate?: string;

  @IsString()
  @MaxLength(60)
  @IsOptional()
  vehicleModel?: string;

  @IsString()
  @IsOptional()
  visitorPhotoPath?: string;

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
