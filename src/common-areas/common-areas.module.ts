import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonAreasService } from './common-areas.service';
import { CommonAreasController } from './common-areas.controller';
import { CommonArea } from './entities/common-area.entity';
import { Reservation } from '../reservations/entities/reservation.entity';

@Module({
  imports: [TypeOrmModule.forFeature([CommonArea, Reservation])],
  controllers: [CommonAreasController],
  providers: [CommonAreasService],
  exports: [CommonAreasService],
})
export class CommonAreasModule {}
