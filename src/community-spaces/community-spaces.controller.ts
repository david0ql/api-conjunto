import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AdminGuard } from '../common/guards/admin.guard';
import { EmployeeOrResidentGuard } from '../common/guards/employee-or-resident.guard';
import { CommunitySpacesService } from './community-spaces.service';
import { CreateCommunitySpaceDto } from './dto/create-community-space.dto';
import { UpdateCommunitySpaceDto } from './dto/update-community-space.dto';

@UseGuards(JwtAuthGuard)
@Controller('community-spaces')
export class CommunitySpacesController {
  constructor(private readonly service: CommunitySpacesService) {}

  @Get()
  @UseGuards(EmployeeOrResidentGuard)
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  @UseGuards(EmployeeOrResidentGuard)
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @UseGuards(AdminGuard)
  create(@Body() dto: CreateCommunitySpaceDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @UseGuards(AdminGuard)
  update(@Param('id') id: string, @Body() dto: UpdateCommunitySpaceDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(AdminGuard)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
