import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { EmployeeGuard } from '../common/guards/employee.guard';
import { AdminGuard } from '../common/guards/admin.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../common/interfaces/jwt-payload.interface';
import { AccessAuditService } from './access-audit.service';
import { CreateAccessAuditDto } from './dto/create-access-audit.dto';
import { UpdateAccessAuditDto } from './dto/update-access-audit.dto';
import { EmployeeOrResidentGuard } from '../common/guards/employee-or-resident.guard';

@UseGuards(JwtAuthGuard)
@Controller('access-audit')
export class AccessAuditController {
  constructor(private readonly service: AccessAuditService) {}

  @Get()
  @UseGuards(EmployeeOrResidentGuard)
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  @UseGuards(EmployeeGuard)
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @UseGuards(EmployeeGuard)
  create(@Body() dto: CreateAccessAuditDto, @CurrentUser() user: JwtPayload) {
    return this.service.create({ ...dto, authorizedByEmployeeId: user.sub });
  }

  @Patch(':id')
  @UseGuards(EmployeeGuard)
  update(@Param('id') id: string, @Body() dto: UpdateAccessAuditDto, @CurrentUser() user: JwtPayload) {
    void user;
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
