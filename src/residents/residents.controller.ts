import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards, BadRequestException } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AdminGuard } from '../common/guards/admin.guard';
import { OperationsEmployeeGuard } from '../common/guards/operations-employee.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../common/interfaces/jwt-payload.interface';
import { ResidentsService } from './residents.service';
import { CreateResidentDto } from './dto/create-resident.dto';
import { UpdateResidentDto } from './dto/update-resident.dto';

@UseGuards(JwtAuthGuard)
@Controller('residents')
export class ResidentsController {
  constructor(private readonly service: ResidentsService) {}

  @Get()
  @UseGuards(OperationsEmployeeGuard)
  findAll(@Query('apartmentId') apartmentId?: string) {
    return this.service.findAll(apartmentId);
  }

  @Get('me')
  getMe(@CurrentUser() user: JwtPayload) {
    return this.service.findOne(user.sub);
  }

  @Get('me/apartments')
  getMyApartments(@CurrentUser() user: JwtPayload) {
    return this.service.getMyApartments(user.sub);
  }

  @Get('me/qr')
  getMyQr(@CurrentUser() user: JwtPayload, @Query('apartmentId') apartmentId?: string) {
    if (!apartmentId) throw new BadRequestException('apartmentId is required');
    return this.service.getQrCode(user.sub, apartmentId);
  }

  @Get(':id')
  @UseGuards(OperationsEmployeeGuard)
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @UseGuards(AdminGuard)
  create(@Body() dto: CreateResidentDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @UseGuards(AdminGuard)
  update(@Param('id') id: string, @Body() dto: UpdateResidentDto) {
    return this.service.update(id, dto);
  }

  @Patch(':id/deactivate')
  @UseGuards(AdminGuard)
  deactivate(@Param('id') id: string) {
    return this.service.deactivate(id);
  }

  @Patch(':id/activate')
  @UseGuards(AdminGuard)
  activate(@Param('id') id: string) {
    return this.service.activate(id);
  }

  @Patch(':id/assign-apartment')
  @UseGuards(AdminGuard)
  assignApartment(@Param('id') id: string, @Body() body: { apartmentId: string }) {
    return this.service.assignApartment(id, body.apartmentId);
  }

  @Patch(':id/unassign-apartment')
  @UseGuards(AdminGuard)
  unassignApartment(@Param('id') id: string) {
    return this.service.unassignApartment(id);
  }

  @Delete(':id')
  @UseGuards(AdminGuard)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
