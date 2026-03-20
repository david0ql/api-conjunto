import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ResidentApartmentsService } from './resident-apartments.service';
import { ResidentApartmentsController } from './resident-apartments.controller';
import { ResidentApartment } from './entities/resident-apartment.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ResidentApartment])],
  controllers: [ResidentApartmentsController],
  providers: [ResidentApartmentsService],
  exports: [ResidentApartmentsService],
})
export class ResidentApartmentsModule {}
