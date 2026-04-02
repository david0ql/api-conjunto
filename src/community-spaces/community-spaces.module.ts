import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommunitySpace } from './entities/community-space.entity';
import { CommunitySpaceSchedule } from './entities/community-space-schedule.entity';
import { CommunitySpacesService } from './community-spaces.service';
import { CommunitySpacesController } from './community-spaces.controller';

@Module({
  imports: [TypeOrmModule.forFeature([CommunitySpace, CommunitySpaceSchedule])],
  controllers: [CommunitySpacesController],
  providers: [CommunitySpacesService],
  exports: [CommunitySpacesService],
})
export class CommunitySpacesModule {}
