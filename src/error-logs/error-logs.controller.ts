import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ErrorLogsService } from './error-logs.service';
import { CreateErrorLogDto } from './dto/create-error-log.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AdminGuard } from '../common/guards/admin.guard';

@Controller('error-logs')
export class ErrorLogsController {
  constructor(private readonly service: ErrorLogsService) {}

  @Post()
  create(@Body() dto: CreateErrorLogDto) {
    return this.service.create(dto);
  }

  @Get()
  @UseGuards(JwtAuthGuard, AdminGuard)
  findAll(@Query('page') page?: string, @Query('limit') limit?: string) {
    return this.service.findAll(page ? Number(page) : 1, limit ? Number(limit) : 50);
  }
}
