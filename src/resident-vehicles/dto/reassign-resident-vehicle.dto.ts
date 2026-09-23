import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class ReassignResidentVehicleDto {
  @IsUUID()
  @IsNotEmpty()
  apartmentId: string;

  /** Por qué se reasigna (queda en el historial de cambios). */
  @IsString()
  @IsOptional()
  @MaxLength(500)
  reason?: string;
}
