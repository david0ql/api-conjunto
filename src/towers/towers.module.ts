import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TowersService } from './towers.service';
import { TowersController } from './towers.controller';
import { Tower } from './entities/tower.entity';
import { Apartment } from '../apartments/entities/apartment.entity';
import { ApartmentStatus } from '../apartment-statuses/entities/apartment-status.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Tower, Apartment, ApartmentStatus])],
  controllers: [TowersController],
  providers: [TowersService],
  exports: [TowersService],
})
export class TowersModule {}
