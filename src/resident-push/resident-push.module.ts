import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CallsModule } from '../calls/calls.module';
import { CallDevice } from '../calls/entities/call-device.entity';
import { Apartment } from '../apartments/entities/apartment.entity';
import { ResidentApartment } from '../resident-apartments/entities/resident-apartment.entity';
import { Resident } from '../residents/entities/resident.entity';
import { ResidentPushService } from './resident-push.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CallDevice,
      Apartment,
      ResidentApartment,
      Resident,
    ]),
    CallsModule,
  ],
  providers: [ResidentPushService],
  exports: [ResidentPushService],
})
export class ResidentPushModule {}
