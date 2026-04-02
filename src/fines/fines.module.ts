import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Fine } from './entities/fine.entity';
import { FineType } from './entities/fine-type.entity';
import { FinesService } from './fines.service';
import { FinesController } from './fines.controller';
import { FineTypesController } from './fine-types.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Fine, FineType])],
  controllers: [FinesController, FineTypesController],
  providers: [FinesService],
  exports: [FinesService],
})
export class FinesModule {}
