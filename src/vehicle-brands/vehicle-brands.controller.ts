import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AdminGuard } from '../common/guards/admin.guard';
import { VehicleBrandsService } from './vehicle-brands.service';
import { CreateVehicleBrandDto } from './dto/create-vehicle-brand.dto';

@UseGuards(JwtAuthGuard)
@Controller('vehicle-brands')
export class VehicleBrandsController {
  constructor(private readonly service: VehicleBrandsService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Post()
  @UseGuards(AdminGuard)
  create(@Body() dto: CreateVehicleBrandDto) {
    return this.service.create(dto);
  }
}
