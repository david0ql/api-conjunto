import { IsUUID, IsNotEmpty, IsDateString, IsString, IsOptional, Matches } from 'class-validator';

export class CreateReservationDto {
  @IsUUID()
  @IsNotEmpty()
  residentId: string;

  @IsUUID()
  @IsNotEmpty()
  areaId: string;

  @IsDateString()
  reservationDate: string;

  @IsString()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/)
  startTime: string;

  @IsString()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/)
  endTime: string;

  @IsUUID()
  @IsNotEmpty()
  statusId: string;

  @IsString()
  @IsOptional()
  notesByAdministrator?: string;

  @IsString()
  @IsOptional()
  notesByResident?: string;
}
