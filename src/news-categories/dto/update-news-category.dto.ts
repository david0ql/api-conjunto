import { IsString, IsOptional, IsBoolean, MaxLength } from 'class-validator';

export class UpdateNewsCategoryDto {
  @IsString()
  @IsOptional()
  @MaxLength(100)
  name?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
