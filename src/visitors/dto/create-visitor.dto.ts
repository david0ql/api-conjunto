import { IsString, IsNotEmpty, IsOptional, MaxLength } from 'class-validator';

export class CreateVisitorDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  name: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  lastName: string;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  document?: string;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  phone?: string;
}
