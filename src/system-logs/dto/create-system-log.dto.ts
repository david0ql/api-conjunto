import { IsString, IsNotEmpty, IsOptional, IsUUID, MaxLength } from 'class-validator';

export class CreateSystemLogDto {
  @IsUUID()
  @IsOptional()
  employeeId?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  action: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  entity: string;

  @IsUUID()
  @IsOptional()
  entityId?: string;
}
