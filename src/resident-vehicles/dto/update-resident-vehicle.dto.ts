import { PartialType } from '@nestjs/mapped-types';
import { CreateResidentVehicleDto } from './create-resident-vehicle.dto';

export class UpdateResidentVehicleDto extends PartialType(CreateResidentVehicleDto) {}
