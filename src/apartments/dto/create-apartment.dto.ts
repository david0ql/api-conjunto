import { IsString, IsNotEmpty, IsOptional, IsNumber, MaxLength, IsUUID } from 'class-validator';

export class CreateApartmentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(10)
  number: string;

  @IsUUID()
  @IsNotEmpty()
  towerId: string;

  @IsNumber()
  @IsOptional()
  floor?: number;

  @IsNumber()
  @IsOptional()
  area?: number;
}
