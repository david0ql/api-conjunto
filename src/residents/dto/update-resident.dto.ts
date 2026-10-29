import { PartialType } from '@nestjs/mapped-types';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateResidentDto } from './create-resident.dto';

export class UpdateResidentDto extends PartialType(CreateResidentDto) {
  /**
   * Si el correo lo tiene un residente inactivo, se le quita a ese residente
   * (queda en su historial) y se asigna a este.
   */
  @IsBoolean()
  @IsOptional()
  takeEmailFromInactive?: boolean;
}
