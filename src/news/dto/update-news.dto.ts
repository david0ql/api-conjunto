import { IsString, IsOptional, IsUUID, IsDateString, MaxLength } from 'class-validator';

export class UpdateNewsDto {
  @IsString()
  @IsOptional()
  @MaxLength(200)
  title?: string;

  @IsString()
  @IsOptional()
  content?: string;

  @IsDateString()
  @IsOptional()
  publishedAt?: string;

  @IsUUID()
  @IsOptional()
  categoryId?: string;
}
