import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { EmployeeOrResidentGuard } from '../common/guards/employee-or-resident.guard';
import { CallsService } from './calls.service';

@Controller('calls')
@UseGuards(JwtAuthGuard, EmployeeOrResidentGuard)
export class CallsController {
  constructor(private readonly callsService: CallsService) {}

  @Get('ice-config')
  getIceConfig() {
    return {
      iceServers: this.callsService.getIceServers(),
    };
  }
}
