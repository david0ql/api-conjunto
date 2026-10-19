import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NewsService } from './news.service';
import { NewsController } from './news.controller';
import { News } from './entities/news.entity';
import { ResidentPushModule } from '../resident-push/resident-push.module';

@Module({
  imports: [TypeOrmModule.forFeature([News]), ResidentPushModule],
  controllers: [NewsController],
  providers: [NewsService],
  exports: [NewsService],
})
export class NewsModule {}
