import { Body, Controller, Get, Ip, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AdminOrPorterGuard } from '../common/guards/admin-or-porter.guard';
import { ResetThrottleGuard } from '../common/guards/reset-throttle.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../common/interfaces/jwt-payload.interface';
import { PasswordResetsService } from './password-resets.service';
import { RequestResetDto } from './dto/request-reset.dto';
import { ConfirmResetDto } from './dto/confirm-reset.dto';

@Controller('password-resets')
export class PasswordResetsController {
  constructor(private readonly service: PasswordResetsService) {}

  /** Admin or porter: trigger a reset link for a resident. */
  @Post('request')
  @UseGuards(JwtAuthGuard, AdminOrPorterGuard)
  request(@Body() dto: RequestResetDto, @CurrentUser() user: JwtPayload, @Ip() ip: string) {
    return this.service.requestForResident(dto.residentId, user.sub, ip);
  }

  /** Public: check whether a reset link is still usable (rate limited). */
  @Get('validate')
  @UseGuards(ResetThrottleGuard)
  validate(@Query('token') token?: string) {
    return this.service.validate(token ?? '');
  }

  /** Public: set the new password using the link token (rate limited). */
  @Post('confirm')
  @UseGuards(ResetThrottleGuard)
  confirm(@Body() dto: ConfirmResetDto, @Ip() ip: string) {
    return this.service.confirm(dto.token, dto.password, ip);
  }
}
