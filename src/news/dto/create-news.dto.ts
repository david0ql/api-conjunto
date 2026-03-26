import { IsString, IsNotEmpty, IsUUID, IsDateString, MaxLength } from 'class-validator';

export class CreateNewsDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @IsString()
  @IsNotEmpty()
  content: string;

  @IsDateString()
  @IsNotEmpty()
  publishedAt: string;

  @IsUUID()
  @IsNotEmpty()
  categoryId: string;

  // set from JWT in controller, not from body
  createdByEmployeeId?: string;
}
