import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Query } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { EmployeeGuard } from '../common/guards/employee.guard';
import { AdminGuard } from '../common/guards/admin.guard';
import { ResidentGuard } from '../common/guards/resident.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../common/interfaces/jwt-payload.interface';
import { AccessAuditService } from './access-audit.service';
import { CreateAccessAuditDto } from './dto/create-access-audit.dto';
import { UpdateAccessAuditDto } from './dto/update-access-audit.dto';
import { EmployeeOrResidentGuard } from '../common/guards/employee-or-resident.guard';
import { ResidentsService } from '../residents/residents.service';

@UseGuards(JwtAuthGuard)
@Controller('access-audit')
export class AccessAuditController {
  constructor(
    private readonly service: AccessAuditService,
    private readonly residentsService: ResidentsService,
  ) {}

  @Get()
  @UseGuards(EmployeeOrResidentGuard)
  findAll() {
    return this.service.findAll();
  }

  @Get('my')
  @UseGuards(ResidentGuard)
  async findMy(@CurrentUser() user: JwtPayload, @Query('apartmentId') apartmentId?: string) {
    const aptId = apartmentId?.trim() || (await this.residentsService.findOne(user.sub)).apartmentId;
    if (!aptId) return [];
    return this.service.findByApartment(aptId);
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
