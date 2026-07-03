import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ResidentApartmentsService } from './resident-apartments.service';
import { ResidentApartmentsController } from './resident-apartments.controller';
import { ResidentApartment } from './entities/resident-apartment.entity';
import { Resident } from '../residents/entities/resident.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ResidentApartment, Resident])],
  controllers: [ResidentApartmentsController],
  providers: [ResidentApartmentsService],
  exports: [ResidentApartmentsService],
})
export class ResidentApartmentsModule {}
