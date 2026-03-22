import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  UploadedFiles,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { mkdirSync } from 'fs';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { EmployeeGuard } from '../common/guards/employee.guard';
import { AdminGuard } from '../common/guards/admin.guard';
import { ResidentGuard } from '../common/guards/resident.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../common/interfaces/jwt-payload.interface';
import { PackagesService } from './packages.service';
import { CreatePackageDto } from './dto/create-package.dto';
import { UpdatePackageDto } from './dto/update-package.dto';

const UPLOAD_DIR = 'uploads/packages';

mkdirSync(UPLOAD_DIR, { recursive: true });

@UseGuards(JwtAuthGuard)
@Controller('packages')
export class PackagesController {
  constructor(private readonly service: PackagesService) {}

  @Get()
  @UseGuards(EmployeeGuard)
  findAll() {
    return this.service.findAll();
  }

  @Get('my')
  @UseGuards(ResidentGuard)
  findMy(@CurrentUser() user: JwtPayload) {
    return this.service.findByResident(user.sub);
  }

  @Get(':id')
  @UseGuards(EmployeeGuard)
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @UseGuards(EmployeeGuard)
  @UseInterceptors(
    FilesInterceptor('photos', 10, {
      storage: diskStorage({
        destination: UPLOAD_DIR,
        filename: (_req, file, cb) => {
          const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
          cb(null, `${unique}${extname(file.originalname)}`);
        },
      }),
      fileFilter: (_req, file, cb) => {
        if (!file.mimetype.startsWith('image/')) {
          return cb(new Error('Solo se permiten imágenes'), false);
        }
        cb(null, true);
      },
      limits: { fileSize: 15 * 1024 * 1024 },
    }),
  )
  create(
    @Body() dto: CreatePackageDto,
    @CurrentUser() user: JwtPayload,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    return this.service.create(
      { ...dto, createdByEmployeeId: user.sub },
      (files ?? []).map((file) => `${UPLOAD_DIR}/${file.filename}`),
    );
  }

  @Patch(':id')
  @UseGuards(EmployeeGuard)
  update(@Param('id') id: string, @Body() dto: UpdatePackageDto) {
    return this.service.update(id, dto);
  }

  @Patch(':id/deliver')
  @UseGuards(EmployeeGuard)
  markDelivered(@Param('id') id: string, @Body() dto: UpdatePackageDto) {
    return this.service.markDelivered(id, dto);
  }

  @Delete(':id')
  @UseGuards(AdminGuard)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  @Get(':id/photos')
  @UseGuards(EmployeeGuard)
  getPhotos(@Param('id') id: string) {
    return this.service.getPhotos(id);
  }

  @Post(':id/photos')
  @UseGuards(EmployeeGuard)
  @UseInterceptors(
    FileInterceptor('photo', {
      storage: diskStorage({
        destination: UPLOAD_DIR,
        filename: (_req, file, cb) => {
          const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
          cb(null, `${unique}${extname(file.originalname)}`);
        },
      }),
      fileFilter: (_req, file, cb) => {
        if (!file.mimetype.startsWith('image/')) {
          return cb(new Error('Solo se permiten imágenes'), false);
        }
        cb(null, true);
      },
      limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB
    }),
  )
  uploadPhoto(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.service.addPhoto(id, `${UPLOAD_DIR}/${file.filename}`);
  }
}
