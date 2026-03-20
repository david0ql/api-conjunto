import { IsString, IsNotEmpty } from 'class-validator';

export class EmployeeLoginDto {
  @IsString()
  @IsNotEmpty()
  username: string;

  @IsString()
  @IsNotEmpty()
  password: string;
}
