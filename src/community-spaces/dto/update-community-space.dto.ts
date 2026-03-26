import { PartialType } from '@nestjs/mapped-types';
import { CreateCommunitySpaceDto } from './create-community-space.dto';
export class UpdateCommunitySpaceDto extends PartialType(CreateCommunitySpaceDto) {}
