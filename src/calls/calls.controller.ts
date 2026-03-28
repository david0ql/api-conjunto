import { Controller, Get, UseGuards } from '@nestjs/common';
import { AdminOrPorterGuard } from '../common/guards/admin-or-porter.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CallsService } from './calls.service';

@Controller('calls')
@UseGuards(JwtAuthGuard)
export class CallsController {
  constructor(private readonly callsService: CallsService) {}

  @Get('porters')
  getPorters() {
    return this.callsService.getPorters();
  }

  @Get('history')
  @UseGuards(AdminOrPorterGuard)
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
