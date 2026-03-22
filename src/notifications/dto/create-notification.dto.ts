import { IsUUID, IsNotEmpty, IsString, IsOptional } from 'class-validator';

export class CreateNotificationDto {
  @IsUUID()
  @IsNotEmpty()
  apartmentId: string;

  @IsUUID()
  @IsOptional()
  residentId?: string;

  @IsUUID()
  @IsNotEmpty()
  notificationTypeId: string;

  @IsString()
  @IsNotEmpty()
  message: string;
}
