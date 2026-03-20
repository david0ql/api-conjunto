import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonAreasService } from './common-areas.service';
import { CommonAreasController } from './common-areas.controller';
import { CommonArea } from './entities/common-area.entity';

@Module({
  imports: [TypeOrmModule.forFeature([CommonArea])],
  controllers: [CommonAreasController],
  providers: [CommonAreasService],
  exports: [CommonAreasService],
})
export class CommonAreasModule {}
