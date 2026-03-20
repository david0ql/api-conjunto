import { PartialType } from '@nestjs/mapped-types';
import { CreateReservationStatusDto } from './create-reservation-status.dto';

export class UpdateReservationStatusDto extends PartialType(CreateReservationStatusDto) {}
