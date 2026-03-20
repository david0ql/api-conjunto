import { PartialType } from '@nestjs/mapped-types';
import { CreatePoolEntryDto } from './create-pool-entry.dto';

export class UpdatePoolEntryDto extends PartialType(CreatePoolEntryDto) {}
