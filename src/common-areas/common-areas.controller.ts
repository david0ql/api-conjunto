import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Query } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AdminGuard } from '../common/guards/admin.guard';
import { CommonAreasService } from './common-areas.service';
import { CreateCommonAreaDto } from './dto/create-common-area.dto';
import { UpdateCommonAreaDto } from './dto/update-common-area.dto';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';

@UseGuards(JwtAuthGuard)
@Controller('common-areas')
export class CommonAreasController {
  constructor(private readonly service: CommonAreasService) {}

  @Get()
  findAll(@Query() pagination: PaginationQueryDto) {
    return this.service.findAll(pagination);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @UseGuards(AdminGuard)
  create(@Body() dto: CreateCommonAreaDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @UseGuards(AdminGuard)
  update(@Param('id') id: string, @Body() dto: UpdateCommonAreaDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(AdminGuard)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
