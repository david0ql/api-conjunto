import { IsBoolean, IsEmail, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class ResidentFromVisitorDto {
  @IsUUID()
  residentTypeId: string;

  @IsUUID()
  apartmentId: string;

  /** Solo hace falta si el visitante quedó registrado sin cédula. */
  @IsString()
  @IsOptional()
  @MaxLength(50)
  document?: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  phone?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;

  @IsBoolean()
  @IsOptional()
  takeEmailFromInactive?: boolean;
}
