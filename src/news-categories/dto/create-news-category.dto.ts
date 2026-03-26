import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class CreateNewsCategoryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;
}
