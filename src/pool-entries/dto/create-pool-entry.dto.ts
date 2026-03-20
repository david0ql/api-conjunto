import { IsUUID, IsNotEmpty, IsOptional, IsInt, Min, IsString } from 'class-validator';

export class CreatePoolEntryDto {
  @IsUUID()
  @IsNotEmpty()
  residentId: string;

  @IsInt()
  @Min(0)
  @IsOptional()
  guestCount?: number;

  @IsUUID()
  @IsOptional()
  createdByEmployeeId?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
