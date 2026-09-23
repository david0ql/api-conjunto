import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChangeLog } from './entities/change-log.entity';
import { ChangeHistoryController } from './change-history.controller';
import { ChangeHistoryService } from './change-history.service';
import { ChangeHistorySubscriber } from './change-history.subscriber';
import { ChangeContextInterceptor } from './change-context.interceptor';

@Module({
  imports: [TypeOrmModule.forFeature([ChangeLog])],
  controllers: [ChangeHistoryController],
  providers: [
    ChangeHistoryService,
    ChangeHistorySubscriber,
    { provide: APP_INTERCEPTOR, useClass: ChangeContextInterceptor },
  ],
})
export class ChangeHistoryModule {}
