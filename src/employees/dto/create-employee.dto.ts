import { IsString, IsNotEmpty, IsOptional, IsBoolean, MaxLength, IsUUID, MinLength, Matches } from 'class-validator';

export class CreateEmployeeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  name: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  lastName: string;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  document?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  // El "@" está reservado para el login de residentes por correo; el login de
  // empleados es por usuario de texto, así que no puede contener "@".
  @Matches(/^[^@]+$/, { message: 'El usuario no puede contener el carácter @' })
  username: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  password: string;

  @IsUUID()
  @IsNotEmpty()
  roleId: string;

  /**
   * Overrides the mobile app's default biometric-login eligibility (off for
   * shared porter logins). Leave unset to keep the client's own default.
   */
  @IsBoolean()
  @IsOptional()
  biometricLoginAllowed?: boolean;
}
