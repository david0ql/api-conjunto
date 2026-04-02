import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateVehicleBrandDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  name: string;
}
