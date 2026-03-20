import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreatePoolEntryDto {
  @IsUUID()
  @IsNotEmpty()
  apartmentId: string;

  @IsArray()
  @IsUUID(undefined, { each: true })
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  residentIds: string[];

  @IsUUID()
  @IsOptional()
  createdByEmployeeId?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsArray()
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  @ArrayMaxSize(10)
  @IsOptional()
  guestNames?: string[];
}
