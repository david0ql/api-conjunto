import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

export class CreateFineDto {
  @IsUUID()
  apartmentId: string;

  @IsUUID()
  fineTypeId: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  amount?: number;

  @IsString()
  @MaxLength(500)
  @IsOptional()
  notes?: string;
}
