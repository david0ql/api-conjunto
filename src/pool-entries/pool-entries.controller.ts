import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { EmployeeGuard } from '../common/guards/employee.guard';
import { AdminGuard } from '../common/guards/admin.guard';
import { PoolEntriesService } from './pool-entries.service';
import { CreatePoolEntryDto } from './dto/create-pool-entry.dto';
import { UpdatePoolEntryDto } from './dto/update-pool-entry.dto';

@UseGuards(JwtAuthGuard)
@Controller('pool-entries')
export class PoolEntriesController {
  constructor(private readonly service: PoolEntriesService) {}

  @Get()
  @UseGuards(AdminGuard)
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  @UseGuards(AdminGuard)
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @UseGuards(EmployeeGuard)
  create(@Body() dto: CreatePoolEntryDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @UseGuards(EmployeeGuard)
  update(@Param('id') id: string, @Body() dto: UpdatePoolEntryDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(AdminGuard)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
