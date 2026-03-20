import { IsUUID, IsNotEmpty, IsOptional, IsDateString } from 'class-validator';

export class CreateResidentApartmentDto {
  @IsUUID()
  @IsNotEmpty()
  residentId: string;

  @IsUUID()
  @IsNotEmpty()
  apartmentId: string;

  @IsDateString()
  @IsOptional()
  startDate?: string;

  @IsDateString()
  @IsOptional()
  endDate?: string;
}
