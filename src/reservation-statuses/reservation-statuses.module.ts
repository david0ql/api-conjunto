import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReservationStatusesService } from './reservation-statuses.service';
import { ReservationStatusesController } from './reservation-statuses.controller';
import { ReservationStatus } from './entities/reservation-status.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ReservationStatus])],
  controllers: [ReservationStatusesController],
  providers: [ReservationStatusesService],
  exports: [ReservationStatusesService],
})
export class ReservationStatusesModule {}
