import { Controller, Post, Body } from '@nestjs/common';
import { AuthService } from './auth.service';
import { ResidentLoginDto } from './dto/resident-login.dto';
import { EmployeeLoginDto } from './dto/employee-login.dto';

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
}
