import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ResidentTypesService } from './resident-types.service';
import { ResidentTypesController } from './resident-types.controller';
import { ResidentType } from './entities/resident-type.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ResidentType])],
  controllers: [ResidentTypesController],
  providers: [ResidentTypesService],
  exports: [ResidentTypesService],
})
export class ResidentTypesModule {}
