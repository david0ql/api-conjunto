import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { OperationsEmployeeGuard } from '../common/guards/operations-employee.guard';
import { AdminGuard } from '../common/guards/admin.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../common/interfaces/jwt-payload.interface';
import { FinesService } from './fines.service';
import { CreateFineDto } from './dto/create-fine.dto';
import { UpdateFineDto } from './dto/update-fine.dto';

@UseGuards(JwtAuthGuard)
@Controller('fines')
export class FinesController {
  constructor(private readonly service: FinesService) {}

  @Get()
  @UseGuards(OperationsEmployeeGuard)
  findAll() {
    return this.service.findAll();
  }

  @Post()
  @UseGuards(OperationsEmployeeGuard)
  create(@Body() dto: CreateFineDto, @CurrentUser() user: JwtPayload) {
    return this.service.create(dto, user.sub);
  }

  @Patch(':id')
  @UseGuards(AdminGuard)
  update(@Param('id') id: string, @Body() dto: UpdateFineDto) {
    return this.service.update(id, dto);
  }
}
