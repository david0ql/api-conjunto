import { PartialType } from '@nestjs/mapped-types';
import { CreateNotificationTypeDto } from './create-notification-type.dto';

export class UpdateNotificationTypeDto extends PartialType(CreateNotificationTypeDto) {}
