import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { mkdirSync } from 'fs';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { EmployeeGuard } from '../common/guards/employee.guard';
import { AdminGuard } from '../common/guards/admin.guard';
import { AdminOrPorterGuard } from '../common/guards/admin-or-porter.guard';
import { VisitorsService } from './visitors.service';
import { CreateVisitorDto } from './dto/create-visitor.dto';
import { UpdateVisitorDto } from './dto/update-visitor.dto';

const UPLOAD_DIR = 'uploads/visitors';

@UseGuards(JwtAuthGuard)
@Controller('visitors')
export class VisitorsController {
  constructor(private readonly service: VisitorsService) {}

  @Get()
  @UseGuards(EmployeeGuard)
  findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('all') all?: string,
  ) {
    if (all === 'true') return this.service.findAllUnpaginated();
    return this.service.findAll({ page: page ? +page : 1, limit: limit ? +limit : 15, search });
  }

  @Get('search')
  @UseGuards(EmployeeGuard)
  findByDocument(@Query('document') document?: string) {
    const normalizedDocument = document?.trim();
    if (!normalizedDocument) {
      throw new BadRequestException('Document is required');
    }
    return this.service.findByDocumentWithLastAccess(normalizedDocument);
  }

  @Get(':id')
  @UseGuards(EmployeeGuard)
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @UseGuards(EmployeeGuard)
  create(@Body() dto: CreateVisitorDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @UseGuards(AdminOrPorterGuard)
  update(@Param('id') id: string, @Body() dto: UpdateVisitorDto) {
    return this.service.update(id, dto);
  }

  @Patch(':id/photo')
  @UseGuards(AdminOrPorterGuard)
  @UseInterceptors(
    FileInterceptor('photo', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          mkdirSync(UPLOAD_DIR, { recursive: true });
          cb(null, UPLOAD_DIR);
        },
        filename: (_req, file, cb) => {
          cb(null, `${Date.now()}${extname(file.originalname)}`);
        },
      }),
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (!file.mimetype.startsWith('image/')) return cb(new BadRequestException('Solo se permiten imágenes'), false);
        cb(null, true);
      },
    }),
  )
  updatePhoto(@Param('id') id: string, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('Se requiere una imagen');
    return this.service.updatePhoto(id, `${UPLOAD_DIR}/${file.filename}`);
  }

  @Delete(':id')
  @UseGuards(AdminGuard)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
