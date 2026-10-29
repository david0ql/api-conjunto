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

/** Pasar la placa a visitante o volverla de residente: el motivo es obligatorio. */
export class ChangeVehicleStatusDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;

  /** Solo al volverla de residente: si va a otro apartamento. */
  @IsUUID()
  @IsOptional()
  apartmentId?: string;
}
