import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ResidentsService } from './residents.service';
import { ResidentsController } from './residents.controller';
import { Resident } from './entities/resident.entity';
import { ResidentApartment } from '../resident-apartments/entities/resident-apartment.entity';
import { ResidentType } from '../resident-types/entities/resident-type.entity';
import { ResidentVehicle } from '../resident-vehicles/entities/resident-vehicle.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Resident, ResidentApartment, ResidentType, ResidentVehicle])],
  controllers: [ResidentsController],
  providers: [ResidentsService],
  exports: [ResidentsService],
})
export class ResidentsModule {}
