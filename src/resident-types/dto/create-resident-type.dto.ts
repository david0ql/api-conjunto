import { IsString, IsNotEmpty, IsOptional, MaxLength } from 'class-validator';

export class CreateResidentTypeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  code: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  name: string;

  @IsString()
  @IsOptional()
  description?: string;
}
