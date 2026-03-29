import { BadRequestException, Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AdminOrPorterGuard } from '../common/guards/admin-or-porter.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import type { JwtPayload } from '../common/interfaces/jwt-payload.interface';
import { CallsPushService } from './calls-push.service';
import { CallsService } from './calls.service';

class RegisterCallDeviceDto {
  token: string;
  platform: 'android' | 'ios';
  channel: 'fcm' | 'voip';
  environment?: 'development' | 'production' | null;
  deviceId?: string | null;
  appVersion?: string | null;
}

class UnregisterCallDeviceDto {
  token?: string;
  platform?: 'android' | 'ios';
  channel?: 'fcm' | 'voip';
  deviceId?: string | null;
}

@Controller('calls')
@UseGuards(JwtAuthGuard)
export class CallsController {
  constructor(
    private readonly callsService: CallsService,
    private readonly callsPushService: CallsPushService,
  ) {}

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

  @Post('devices')
  async registerDevice(@CurrentUser() user: JwtPayload, @Body() dto: RegisterCallDeviceDto) {
    if (!dto?.token || !dto?.platform || !dto?.channel) {
      throw new BadRequestException('token, platform y channel son requeridos');
    }

    await this.callsPushService.registerDevice(user, dto);
    return { ok: true };
  }

  @Post('devices/unregister')
  async unregisterDevice(@CurrentUser() user: JwtPayload, @Body() dto: UnregisterCallDeviceDto = {}) {
    await this.callsPushService.unregisterDevice(user, dto);
    return { ok: true };
  }
}
