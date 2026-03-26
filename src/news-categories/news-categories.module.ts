import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NewsCategoriesService } from './news-categories.service';
import { NewsCategoriesController } from './news-categories.controller';
import { NewsCategory } from './entities/news-category.entity';

@Module({
  imports: [TypeOrmModule.forFeature([NewsCategory])],
  controllers: [NewsCategoriesController],
  providers: [NewsCategoriesService],
  exports: [NewsCategoriesService],
})
export class NewsCategoriesModule {}
