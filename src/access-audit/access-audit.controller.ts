import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { EmployeeGuard } from '../common/guards/employee.guard';
import { AdminGuard } from '../common/guards/admin.guard';
import { AccessAuditService } from './access-audit.service';
import { CreateAccessAuditDto } from './dto/create-access-audit.dto';
import { UpdateAccessAuditDto } from './dto/update-access-audit.dto';

@UseGuards(JwtAuthGuard)
@Controller('access-audit')
export class AccessAuditController {
  constructor(private readonly service: AccessAuditService) {}

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
  create(@Body() dto: CreateAccessAuditDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @UseGuards(EmployeeGuard)
  update(@Param('id') id: string, @Body() dto: UpdateAccessAuditDto) {
    return this.service.update(id, dto);
  }

  @Patch(':id/exit')
  @UseGuards(EmployeeGuard)
  registerExit(@Param('id') id: string) {
    return this.service.registerExit(id);
  }

  @Delete(':id')
  @UseGuards(AdminGuard)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
