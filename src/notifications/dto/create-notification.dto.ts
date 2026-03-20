import { IsUUID, IsNotEmpty, IsString } from 'class-validator';

export class CreateNotificationDto {
  @IsUUID()
  @IsNotEmpty()
  residentId: string;

  @IsUUID()
  @IsNotEmpty()
  notificationTypeId: string;

  @IsString()
  @IsNotEmpty()
  message: string;
}
