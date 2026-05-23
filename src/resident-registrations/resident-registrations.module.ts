import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MulterModule } from '@nestjs/platform-express';
import { RegistrationLink } from './entities/registration-link.entity';
import { RegistrationRequest } from './entities/registration-request.entity';
import { RegistrationRequestPerson } from './entities/registration-request-person.entity';
import { RegistrationRequestVehicle } from './entities/registration-request-vehicle.entity';
import { Resident } from '../residents/entities/resident.entity';
import { ResidentApartment } from '../resident-apartments/entities/resident-apartment.entity';
import { VehicleBrand } from '../vehicle-brands/entities/vehicle-brand.entity';
import { ResidentVehicle } from '../resident-vehicles/entities/resident-vehicle.entity';
import { Tower } from '../towers/entities/tower.entity';
import { Apartment } from '../apartments/entities/apartment.entity';
import { ResidentType } from '../resident-types/entities/resident-type.entity';
import { ResidentRegistrationsController } from './resident-registrations.controller';
import { ResidentRegistrationsService } from './resident-registrations.service';

@Module({
  imports: [
    MulterModule.register({}),
    TypeOrmModule.forFeature([
      RegistrationLink,
      RegistrationRequest,
      RegistrationRequestPerson,
      RegistrationRequestVehicle,
      Resident,
      ResidentApartment,
      VehicleBrand,
      ResidentVehicle,
      Tower,
      Apartment,
      ResidentType,
    ]),
  ],
  controllers: [ResidentRegistrationsController],
  providers: [ResidentRegistrationsService],
})
export class ResidentRegistrationsModule {}
