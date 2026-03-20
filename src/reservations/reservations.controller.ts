import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AdminGuard } from '../common/guards/admin.guard';
import { EmployeeGuard } from '../common/guards/employee.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../common/interfaces/jwt-payload.interface';
import { ReservationsService } from './reservations.service';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { UpdateReservationDto } from './dto/update-reservation.dto';

@UseGuards(JwtAuthGuard)
@Controller('reservations')
export class ReservationsController {
  constructor(private readonly service: ReservationsService) {}

  @Get()
  @UseGuards(EmployeeGuard)
  findAll() {
    return this.service.findAll();
  }

  @Get('my')
  findMy(@CurrentUser() user: JwtPayload) {
    return this.service.findByResident(user.sub);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateReservationDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateReservationDto) {
    return this.service.update(id, dto);
  }

  @Patch(':id/status')
  @UseGuards(AdminGuard)
  updateStatus(
    @Param('id') id: string,
    @Body() body: { statusId: string; notesByAdministrator?: string },
  ) {
    return this.service.updateStatus(id, body.statusId, body.notesByAdministrator);
  }

  @Delete(':id')
  @UseGuards(AdminGuard)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
