import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class ResidentToVisitorDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}
