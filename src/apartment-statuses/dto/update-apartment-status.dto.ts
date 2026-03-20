import { PartialType } from '@nestjs/mapped-types';
import { CreateApartmentStatusDto } from './create-apartment-status.dto';

export class UpdateApartmentStatusDto extends PartialType(CreateApartmentStatusDto) {}
