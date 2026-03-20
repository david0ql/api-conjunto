import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AdminGuard } from '../common/guards/admin.guard';
import { EmployeeGuard } from '../common/guards/employee.guard';
import { ResidentApartmentsService } from './resident-apartments.service';
import { CreateResidentApartmentDto } from './dto/create-resident-apartment.dto';
import { UpdateResidentApartmentDto } from './dto/update-resident-apartment.dto';

@UseGuards(JwtAuthGuard)
@Controller('resident-apartments')
export class ResidentApartmentsController {
  constructor(private readonly service: ResidentApartmentsService) {}

  @Get()
  @UseGuards(EmployeeGuard)
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  @UseGuards(EmployeeGuard)
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Get('by-resident/:residentId')
  @UseGuards(EmployeeGuard)
  findByResident(@Param('residentId') residentId: string) {
    return this.service.findByResident(residentId);
  }

  @Get('by-apartment/:apartmentId')
  @UseGuards(EmployeeGuard)
  findByApartment(@Param('apartmentId') apartmentId: string) {
    return this.service.findByApartment(apartmentId);
  }

  @Post()
  @UseGuards(AdminGuard)
  create(@Body() dto: CreateResidentApartmentDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @UseGuards(AdminGuard)
  update(@Param('id') id: string, @Body() dto: UpdateResidentApartmentDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(AdminGuard)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
