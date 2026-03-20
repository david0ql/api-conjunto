import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AdminGuard } from '../common/guards/admin.guard';
import { TowersService } from './towers.service';
import { CreateTowerDto } from './dto/create-tower.dto';

@UseGuards(JwtAuthGuard)
@Controller('towers')
export class TowersController {
  constructor(private readonly service: TowersService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Post()
  @UseGuards(AdminGuard)
  create(@Body() dto: CreateTowerDto) {
    return this.service.create(dto);
  }
}
