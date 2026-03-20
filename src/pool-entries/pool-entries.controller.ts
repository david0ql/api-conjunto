import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AdminGuard } from '../common/guards/admin.guard';
import { PoolOperatorGuard } from '../common/guards/pool-operator.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../common/interfaces/jwt-payload.interface';
import type { Response } from 'express';
import { PoolEntriesService } from './pool-entries.service';
import { CreatePoolEntryDto } from './dto/create-pool-entry.dto';
import { UpdatePoolEntryDto } from './dto/update-pool-entry.dto';

@UseGuards(JwtAuthGuard)
@Controller('pool-entries')
export class PoolEntriesController {
  constructor(private readonly service: PoolEntriesService) {}

  @Get()
  @UseGuards(PoolOperatorGuard)
  findAll() {
    return this.service.findAll();
  }

  @Get('resident-search')
  @UseGuards(PoolOperatorGuard)
  searchResidents(
    @Query('apartmentId') apartmentId?: string,
    @Query('tower') tower?: string,
    @Query('number') number?: string,
  ) {
    return this.service.findResidentsByApartment({ apartmentId, tower, number });
  }

  @Get('guest-suggestions')
  @UseGuards(PoolOperatorGuard)
  guestSuggestions(@Query('query') query?: string) {
    return this.service.getGuestSuggestions(query);
  }

  @Get('reports/summary')
  @UseGuards(PoolOperatorGuard)
  summary(
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.service.getSummary({ dateFrom, dateTo });
  }

  @Get('reports/pdf')
  @UseGuards(PoolOperatorGuard)
  async pdf(
    @Query('dateFrom') dateFrom: string | undefined,
    @Query('dateTo') dateTo: string | undefined,
    @Res() res: Response,
  ) {
    const pdfBuffer = await this.service.buildPdfReport({ dateFrom, dateTo });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=pool-report.pdf');
    res.send(pdfBuffer);
  }

  @Get(':id')
  @UseGuards(PoolOperatorGuard)
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @UseGuards(PoolOperatorGuard)
  create(@Body() dto: CreatePoolEntryDto, @CurrentUser() user: JwtPayload) {
    return this.service.create({ ...dto, createdByEmployeeId: user.sub });
  }

  @Patch(':id')
  @UseGuards(PoolOperatorGuard)
  update(@Param('id') id: string, @Body() dto: UpdatePoolEntryDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(AdminGuard)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
