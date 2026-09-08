import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AdminGuard } from '../common/guards/admin.guard';
import { AdminOrPorterGuard } from '../common/guards/admin-or-porter.guard';
import { OperationsEmployeeGuard } from '../common/guards/operations-employee.guard';
import { ResidentGuard } from '../common/guards/resident.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../common/interfaces/jwt-payload.interface';
import { ResidentsService } from './residents.service';
import { CreateResidentDto } from './dto/create-resident.dto';
import { UpdateResidentDto } from './dto/update-resident.dto';
import { CreateFamilyMemberDto } from './dto/create-family-member.dto';

@UseGuards(JwtAuthGuard)
@Controller('residents')
export class ResidentsController {
  constructor(private readonly service: ResidentsService) {}

  @Get()
  @UseGuards(OperationsEmployeeGuard)
  findAll(
    @Query('apartmentId') apartmentId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('typeId') typeId?: string,
    @Query('isActive') isActive?: string,
    @Query('hasApartment') hasApartment?: string,
    @Query('towerId') towerId?: string,
  ) {
    const pagination = {
      page: page ? Math.max(1, +page || 1) : 1,
      limit: limit ? Math.min(1000, Math.max(1, +limit || 15)) : 15,
      search, typeId, isActive, hasApartment, towerId,
    };
    return this.service.findAll(apartmentId, pagination);
  }

  @Get('stats')
  @UseGuards(OperationsEmployeeGuard)
  getStats() {
    return this.service.getStats();
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
  getMyQr(
    @CurrentUser() user: JwtPayload,
    @Query('apartmentId') apartmentId?: string,
    @Query('residentId') residentId?: string,
  ) {
    if (!apartmentId) throw new BadRequestException('apartmentId is required');
    return this.service.getQrCode(residentId ?? user.sub, apartmentId, user.sub);
  }

  @Get('me/family')
  @UseGuards(ResidentGuard)
  getMyFamily(@CurrentUser() user: JwtPayload) {
    return this.service.getFamilyMembers(user.sub);
  }

  @Get('me/vehicles')
  @UseGuards(ResidentGuard)
  getMyVehicles(@CurrentUser() user: JwtPayload) {
    return this.service.getMyVehicles(user.sub);
  }

  @Post('me/family')
  @UseGuards(ResidentGuard)
  @UseInterceptors(
    FileInterceptor('photo', {
      storage: diskStorage({
        destination: (req, file, cb) => {
          const folder = 'uploads/residents/family';
          const fs = require('fs');
          if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
          cb(null, folder);
        },
        filename: (req, file, cb) => {
          const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}${extname(file.originalname)}`;
          cb(null, unique);
        },
      }),
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  createFamilyMember(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateFamilyMemberDto,
    @UploadedFile() photo?: Express.Multer.File,
  ) {
    return this.service.createFamilyMember(user.sub, dto, photo?.path);
  }

  @Get(':id')
  @UseGuards(OperationsEmployeeGuard)
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @UseGuards(AdminOrPorterGuard)
  create(@Body() dto: CreateResidentDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @UseGuards(AdminOrPorterGuard)
  update(@Param('id') id: string, @Body() dto: UpdateResidentDto) {
    return this.service.update(id, dto);
  }

  @Patch(':id/deactivate')
  @UseGuards(AdminOrPorterGuard)
  deactivate(@Param('id') id: string) {
    return this.service.deactivate(id);
  }

  @Patch(':id/activate')
  @UseGuards(AdminOrPorterGuard)
  activate(@Param('id') id: string) {
    return this.service.activate(id);
  }

  // El portero necesita asignar apartamento como parte del alta de residente.
  @Patch(':id/assign-apartment')
  @UseGuards(AdminOrPorterGuard)
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
