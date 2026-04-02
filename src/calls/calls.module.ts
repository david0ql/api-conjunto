import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Apartment } from '../apartments/entities/apartment.entity';
import { Employee } from '../employees/entities/employee.entity';
import { ResidentApartment } from '../resident-apartments/entities/resident-apartment.entity';
import { Resident } from '../residents/entities/resident.entity';
import { CallsController } from './calls.controller';
import { CallsGateway } from './calls.gateway';
import { CallsPushService } from './calls-push.service';
import { CallsService } from './calls.service';
import { CallDevice } from './entities/call-device.entity';
import { CallSession } from './entities/call-session.entity';
import { CallTraceEvent } from './entities/call-trace-event.entity';

@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: process.env.JWT_SECRET ?? 'fallback-secret',
      }),
    }),
    TypeOrmModule.forFeature([
      CallSession,
      CallDevice,
      CallTraceEvent,
      Apartment,
      Employee,
      Resident,
      ResidentApartment,
    ]),
  ],
  controllers: [CallsController],
  providers: [CallsService, CallsPushService, CallsGateway],
  exports: [CallsService, CallsPushService],
})
export class CallsModule {}
