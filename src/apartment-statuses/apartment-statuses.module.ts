import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApartmentStatusesService } from './apartment-statuses.service';
import { ApartmentStatusesController } from './apartment-statuses.controller';
import { ApartmentStatus } from './entities/apartment-status.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ApartmentStatus])],
  controllers: [ApartmentStatusesController],
  providers: [ApartmentStatusesService],
  exports: [ApartmentStatusesService],
})
export class ApartmentStatusesModule {}
