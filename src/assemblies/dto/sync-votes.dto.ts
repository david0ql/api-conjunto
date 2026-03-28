import { IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { SubmitVoteDto } from './submit-vote.dto';

export class SyncVotesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SubmitVoteDto)
  votes: SubmitVoteDto[];
}
