import { IsOptional, IsString, MaxLength } from 'class-validator';

/** Motivo de inhabilitar o volver a habilitar un residente; queda en el historial. */
export class ChangeStatusDto {
  @IsString()
  @IsOptional()
  @MaxLength(500)
  reason?: string;
}
