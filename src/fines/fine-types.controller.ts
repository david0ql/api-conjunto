import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { OperationsEmployeeGuard } from '../common/guards/operations-employee.guard';
import { AdminGuard } from '../common/guards/admin.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../common/interfaces/jwt-payload.interface';
import { FinesService } from './fines.service';
import { CreateFineTypeDto } from './dto/create-fine-type.dto';
import { UpdateFineTypeValueDto } from './dto/update-fine-type-value.dto';

@UseGuards(JwtAuthGuard)
@Controller('fine-types')
export class FineTypesController {
  constructor(private readonly service: FinesService) {}

  @Get()
  @UseGuards(OperationsEmployeeGuard)
  findAll() {
    return this.service.findFineTypes();
  }

  @Post()
  @UseGuards(AdminGuard)
  create(@Body() dto: CreateFineTypeDto, @CurrentUser() user: JwtPayload) {
    return this.service.createFineType(dto, user.sub);
  }

  @Patch(':id/value')
  @UseGuards(AdminGuard)
  updateValue(@Param('id') id: string, @Body() dto: UpdateFineTypeValueDto) {
    return this.service.updateFineTypeValue(id, dto);
  }
}
