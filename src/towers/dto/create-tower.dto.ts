import { IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class CreateTowerDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(10)
  code: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name: string;

  @IsInt()
  @Min(1)
  @Max(99)
  totalFloors: number;

  @IsInt()
  @Min(1)
  @Max(50)
  apartmentsPerFloor: number;

  @IsUUID()
  @IsOptional()
  apartmentStatusId?: string;
}
