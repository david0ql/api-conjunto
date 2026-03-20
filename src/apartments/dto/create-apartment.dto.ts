import { IsString, IsNotEmpty, IsOptional, IsNumber, MaxLength, IsUUID } from 'class-validator';

export class CreateApartmentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(10)
  number: string;

  @IsString()
  @IsOptional()
  @MaxLength(10)
  tower?: string;

  @IsNumber()
  @IsOptional()
  floor?: number;

  @IsNumber()
  @IsOptional()
  area?: number;

  @IsUUID()
  @IsNotEmpty()
  statusId: string;
}
