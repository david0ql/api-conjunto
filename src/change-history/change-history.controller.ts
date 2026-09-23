import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { OperationsEmployeeGuard } from '../common/guards/operations-employee.guard';
import { ChangeHistoryService } from './change-history.service';
import { ChangeHistoryQueryDto } from './dto/change-history-query.dto';

@UseGuards(JwtAuthGuard, OperationsEmployeeGuard)
@Controller('change-history')
export class ChangeHistoryController {
  constructor(private readonly service: ChangeHistoryService) {}

  @Get()
  findAll(@Query() query: ChangeHistoryQueryDto) {
    return this.service.findAll(query);
  }
}
