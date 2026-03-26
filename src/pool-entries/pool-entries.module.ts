import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PoolEntriesService } from './pool-entries.service';
import { PoolEntriesController } from './pool-entries.controller';
import { PoolEntry } from './entities/pool-entry.entity';
import { PoolEntryGuest } from './entities/pool-entry-guest.entity';
import { PoolEntryResident } from './entities/pool-entry-resident.entity';
import { Apartment } from '../apartments/entities/apartment.entity';
import { Resident } from '../residents/entities/resident.entity';

@Module({
  imports: [TypeOrmModule.forFeature([PoolEntry, PoolEntryGuest, PoolEntryResident, Apartment, Resident])],
  controllers: [PoolEntriesController],
  providers: [PoolEntriesService],
  exports: [PoolEntriesService],
})
export class PoolEntriesModule {}
