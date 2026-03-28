import { IsString, IsNotEmpty, IsIn, IsOptional } from 'class-validator';

export class SubmitVoteDto {
  @IsString()
  @IsNotEmpty()
  questionId: string;

  @IsString()
  @IsNotEmpty()
  assemblyId: string;

  @IsIn(['yes', 'no', 'blank'])
  vote: 'yes' | 'no' | 'blank';

  @IsOptional()
  @IsString()
  votedAt?: string;

  @IsOptional()
  @IsString()
  token?: string;
}
