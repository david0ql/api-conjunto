import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PoolEntriesService } from './pool-entries.service';
import { PoolEntriesController } from './pool-entries.controller';
import { PoolEntry } from './entities/pool-entry.entity';
import { PoolEntryGuest } from './entities/pool-entry-guest.entity';
import { PoolEntryResident } from './entities/pool-entry-resident.entity';
import { ResidentApartment } from '../resident-apartments/entities/resident-apartment.entity';
import { Apartment } from '../apartments/entities/apartment.entity';

@Module({
  imports: [TypeOrmModule.forFeature([PoolEntry, PoolEntryGuest, PoolEntryResident, ResidentApartment, Apartment])],
  controllers: [PoolEntriesController],
  providers: [PoolEntriesService],
  exports: [PoolEntriesService],
})
export class PoolEntriesModule {}
