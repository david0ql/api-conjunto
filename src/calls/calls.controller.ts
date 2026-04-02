import { BadRequestException, Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AdminOrPorterGuard } from '../common/guards/admin-or-porter.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import type { JwtPayload } from '../common/interfaces/jwt-payload.interface';
import { CallsPushService } from './calls-push.service';
import { CallsService } from './calls.service';

class RegisterCallDeviceDto {
  @IsString()
  token: string;

  @IsIn(['android', 'ios'])
  platform: 'android' | 'ios';

  @IsIn(['fcm', 'voip'])
  channel: 'fcm' | 'voip';

  @IsOptional()
  @IsIn(['development', 'production', null])
  environment?: 'development' | 'production' | null;

  @IsOptional()
  @IsString()
  deviceId?: string | null;

  @IsOptional()
  @IsString()
  appVersion?: string | null;
}

class UnregisterCallDeviceDto {
  @IsOptional()
  @IsString()
  token?: string;

  @IsOptional()
  @IsIn(['android', 'ios'])
  platform?: 'android' | 'ios';

  @IsOptional()
  @IsIn(['fcm', 'voip'])
  channel?: 'fcm' | 'voip';

  @IsOptional()
  @IsString()
  deviceId?: string | null;
}

class CreateCallTraceDto {
  @IsString()
  callId: string;

  @IsIn(['web', 'mobile', 'api'])
  source: 'web' | 'mobile' | 'api';

  @IsString()
  @MaxLength(80)
  stage: string;

  @IsString()
  @MaxLength(240)
  message: string;

  @IsOptional()
  @IsIn(['info', 'warn', 'error'])
  level?: 'info' | 'warn' | 'error';

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown> | null;
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

  @Post('trace')
  async createTrace(@CurrentUser() user: JwtPayload, @Body() dto: CreateCallTraceDto) {
    if (!dto?.callId || !dto?.source || !dto?.stage || !dto?.message) {
      throw new BadRequestException('callId, source, stage y message son requeridos');
    }
    await this.callsService.createTraceForUser(dto.callId, user, dto);
    return { ok: true };
  }
}
