import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommunitySpace } from './entities/community-space.entity';
import { CommunitySpacesService } from './community-spaces.service';
import { CommunitySpacesController } from './community-spaces.controller';

@Module({
  imports: [TypeOrmModule.forFeature([CommunitySpace])],
  controllers: [CommunitySpacesController],
  providers: [CommunitySpacesService],
  exports: [CommunitySpacesService],
})
export class CommunitySpacesModule {}
