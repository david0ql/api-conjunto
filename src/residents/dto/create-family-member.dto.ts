import { IsString, IsNotEmpty, IsOptional, IsEmail, MaxLength, IsDateString } from 'class-validator';

export class CreateFamilyMemberDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  name: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  lastName: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  document: string;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  phone?: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsDateString()
  @IsOptional()
  birthDate?: string;
}
