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
import { CallPushJob } from './entities/call-push-job.entity';
import { CallQueueEntry } from './entities/call-queue-entry.entity';
import { CallQueueService } from './call-queue.service';
import { Notification } from '../notifications/entities/notification.entity';
import { NotificationType } from '../notification-types/entities/notification-type.entity';

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
      CallPushJob,
      CallQueueEntry,
      Notification,
      NotificationType,
      Apartment,
      Employee,
      Resident,
      ResidentApartment,
    ]),
  ],
  controllers: [CallsController],
  providers: [CallsService, CallsPushService, CallQueueService, CallsGateway],
  exports: [CallsService, CallsPushService],
})
export class CallsModule {}
