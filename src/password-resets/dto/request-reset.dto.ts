import { IsUUID } from 'class-validator';

export class RequestResetDto {
  @IsUUID('4', { message: 'residentId inválido' })
  residentId: string;
}
