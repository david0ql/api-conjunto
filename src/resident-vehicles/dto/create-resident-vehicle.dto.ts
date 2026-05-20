import { IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export const VEHICLE_TYPES = ['car', 'motorcycle', 'truck', 'bicycle', 'other'] as const;

export class CreateResidentVehicleDto {
  @IsUUID()
  @IsNotEmpty()
  apartmentId: string;

  @IsUUID()
  @IsNotEmpty()
  vehicleBrandId: string;

  @IsString()
  @IsNotEmpty()
  @IsIn(VEHICLE_TYPES)
  vehicleType: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(15)
  plate: string;

  @IsString()
  @IsOptional()
  @MaxLength(40)
  color?: string;

  @IsString()
  @IsOptional()
  @MaxLength(60)
  model?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
