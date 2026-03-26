import { IsString, IsNotEmpty, MaxLength, IsOptional, IsBoolean } from 'class-validator';

export class CreateCommunitySpaceDto {
  @IsString() @IsNotEmpty() @MaxLength(100)
  name: string;

  @IsString() @IsNotEmpty() @MaxLength(50)
  phase: string;

  @IsOptional() @IsString()
  description?: string;

  @IsOptional() @IsBoolean()
  isActive?: boolean;
}
