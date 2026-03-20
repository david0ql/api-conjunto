import { IsString, IsNotEmpty, IsUUID, MaxLength } from 'class-validator';

export class CreateVehicleDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(10)
  plate: string;

  @IsUUID()
  @IsNotEmpty()
  vehicleTypeId: string;

  @IsUUID()
  @IsNotEmpty()
  residentId: string;
}
