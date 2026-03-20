import { PartialType } from '@nestjs/mapped-types';
import { CreateResidentApartmentDto } from './create-resident-apartment.dto';

export class UpdateResidentApartmentDto extends PartialType(CreateResidentApartmentDto) {}
