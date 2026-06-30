import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class ConfirmResetDto {
  @IsString()
  @MinLength(20, { message: 'Token inválido' })
  @MaxLength(200, { message: 'Token inválido' })
  token: string;

  @IsString()
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres' })
  // bcrypt only considers the first 72 bytes; reject longer to avoid silent truncation.
  @MaxLength(72, { message: 'La contraseña es demasiado larga' })
  @Matches(/(?=.*[A-Za-z])(?=.*\d)/, {
    message: 'La contraseña debe incluir al menos una letra y un número',
  })
  password: string;
}
