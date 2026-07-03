import { IsString, IsNotEmpty, IsOptional, MaxLength, IsUUID, MinLength, Matches } from 'class-validator';

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
}
