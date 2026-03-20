import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AdminGuard } from '../common/guards/admin.guard';
import { ReservationStatusesService } from './reservation-statuses.service';
import { CreateReservationStatusDto } from './dto/create-reservation-status.dto';
import { UpdateReservationStatusDto } from './dto/update-reservation-status.dto';

@UseGuards(JwtAuthGuard)
@Controller('reservation-statuses')
export class ReservationStatusesController {
  constructor(private readonly service: ReservationStatusesService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @UseGuards(AdminGuard)
  create(@Body() dto: CreateReservationStatusDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @UseGuards(AdminGuard)
  update(@Param('id') id: string, @Body() dto: UpdateReservationStatusDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(AdminGuard)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
