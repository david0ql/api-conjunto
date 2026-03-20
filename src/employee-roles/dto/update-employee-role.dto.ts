import { PartialType } from '@nestjs/mapped-types';
import { CreateEmployeeRoleDto } from './create-employee-role.dto';

export class UpdateEmployeeRoleDto extends PartialType(CreateEmployeeRoleDto) {}
