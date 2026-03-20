import { IsString, IsNotEmpty } from 'class-validator';

export class ResidentLoginDto {
  @IsString()
  @IsNotEmpty()
  identifier: string;

  @IsString()
  @IsNotEmpty()
  password: string;
}
