import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AdminGuard } from '../common/guards/admin.guard';
import { AdminOrPorterGuard } from '../common/guards/admin-or-porter.guard';
import { OperationsEmployeeGuard } from '../common/guards/operations-employee.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../common/interfaces/jwt-payload.interface';
import { ResidentVehiclesService } from './resident-vehicles.service';
import { CreateResidentVehicleDto } from './dto/create-resident-vehicle.dto';
import { UpdateResidentVehicleDto } from './dto/update-resident-vehicle.dto';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';

@UseGuards(JwtAuthGuard)
@Controller('resident-vehicles')
export class ResidentVehiclesController {
  constructor(private readonly service: ResidentVehiclesService) {}

  @Get()
  @UseGuards(OperationsEmployeeGuard)
  findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('apartmentId') apartmentId?: string,
  ) {
    return this.service.findAll({ page: page ? +page : 1, limit: limit ? +limit : 15, search, apartmentId });
  }

  @Get('by-apartment/:apartmentId')
  @UseGuards(OperationsEmployeeGuard)
  findByApartment(@Param('apartmentId') apartmentId: string) {
    return this.service.findByApartment(apartmentId);
  }

  @Get('by-plate/:plate')
  @UseGuards(OperationsEmployeeGuard)
  findByPlate(@Param('plate') plate: string) {
    return this.service.findByPlate(plate);
  }

  @Get(':id')
  @UseGuards(OperationsEmployeeGuard)
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @UseGuards(AdminOrPorterGuard)
  create(@Body() dto: CreateResidentVehicleDto, @CurrentUser() user: JwtPayload) {
    return this.service.create(dto, user.sub);
  }

  @Patch(':id')
  @UseGuards(AdminOrPorterGuard)
  update(@Param('id') id: string, @Body() dto: UpdateResidentVehicleDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(AdminGuard)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
