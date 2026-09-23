import { IsEmail } from 'class-validator';

export class RequestResetByEmailDto {
  @IsEmail({}, { message: 'Correo inválido' })
  email: string;
}
