import { Controller, Post, Body, Get, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { ResidentLoginDto } from './dto/resident-login.dto';
import { EmployeeLoginDto } from './dto/employee-login.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../common/interfaces/jwt-payload.interface';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login/resident')
  loginResident(@Body() dto: ResidentLoginDto) {
    return this.authService.loginResident(dto);
  }

  @Post('login/employee')
  loginEmployee(@Body() dto: EmployeeLoginDto) {
    return this.authService.loginEmployee(dto);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  getSession(@CurrentUser() user: JwtPayload) {
    return this.authService.getSession(user);
  }
}
