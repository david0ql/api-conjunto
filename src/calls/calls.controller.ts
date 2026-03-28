import { Controller, Get, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../common/guards/admin.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { EmployeeOrResidentGuard } from '../common/guards/employee-or-resident.guard';
import { CallsService } from './calls.service';

@Controller('calls')
@UseGuards(JwtAuthGuard, EmployeeOrResidentGuard)
export class CallsController {
  constructor(private readonly callsService: CallsService) {}

  @Get('porters')
  getPorters() {
    return this.callsService.getPorters();
  }

  @Get('history')
  @UseGuards(AdminGuard)
  getHistory() {
    return this.callsService.getCallHistory();
  }

  @Get('ice-config')
  getIceConfig() {
    return {
      iceServers: this.callsService.getIceServers(),
    };
  }
}
