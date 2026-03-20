import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PoolEntriesService } from './pool-entries.service';
import { PoolEntriesController } from './pool-entries.controller';
import { PoolEntry } from './entities/pool-entry.entity';

@Module({
  imports: [TypeOrmModule.forFeature([PoolEntry])],
  controllers: [PoolEntriesController],
  providers: [PoolEntriesService],
  exports: [PoolEntriesService],
})
export class PoolEntriesModule {}
