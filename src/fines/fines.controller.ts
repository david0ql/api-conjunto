import { Body, Controller, Get, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { OperationsEmployeeGuard } from '../common/guards/operations-employee.guard';
import { AdminGuard } from '../common/guards/admin.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../common/interfaces/jwt-payload.interface';
import type { Response } from 'express';
import { FinesService } from './fines.service';
import { CreateFineDto } from './dto/create-fine.dto';
import { UpdateFineDto } from './dto/update-fine.dto';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';

@UseGuards(JwtAuthGuard)
@Controller('fines')
export class FinesController {
  constructor(private readonly service: FinesService) {}

  @Get()
  @UseGuards(OperationsEmployeeGuard)
  findAll(
    @Query() pagination: PaginationQueryDto,
    @Query('towerId') towerId?: string,
    @Query('apartmentId') apartmentId?: string,
    @Query('residentId') residentId?: string,
    @Query('fineTypeId') fineTypeId?: string,
    @Query('createdByEmployeeId') createdByEmployeeId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.service.findAll(
      { towerId, apartmentId, residentId, fineTypeId, createdByEmployeeId, dateFrom, dateTo },
      pagination,
    );
  }

  @Get('reports/pdf')
  @UseGuards(OperationsEmployeeGuard)
  async pdf(
    @Query('towerId') towerId: string | undefined,
    @Query('apartmentId') apartmentId: string | undefined,
    @Query('residentId') residentId: string | undefined,
    @Query('fineTypeId') fineTypeId: string | undefined,
    @Query('createdByEmployeeId') createdByEmployeeId: string | undefined,
    @Query('dateFrom') dateFrom: string | undefined,
    @Query('dateTo') dateTo: string | undefined,
    @Res() res: Response,
  ) {
    const pdfBuffer = await this.service.buildPdfReport({
      towerId,
      apartmentId,
      residentId,
      fineTypeId,
      createdByEmployeeId,
      dateFrom,
      dateTo,
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=fines-report.pdf');
    res.send(pdfBuffer);
  }

  @Post()
  @UseGuards(OperationsEmployeeGuard)
  create(@Body() dto: CreateFineDto, @CurrentUser() user: JwtPayload) {
    return this.service.create(dto, user.sub);
  }

  @Patch(':id')
  @UseGuards(AdminGuard)
  update(@Param('id') id: string, @Body() dto: UpdateFineDto) {
    return this.service.update(id, dto);
  }
}
