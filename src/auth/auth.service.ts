import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { Resident } from '../residents/entities/resident.entity';
import { Employee } from '../employees/entities/employee.entity';
import { ResidentLoginDto } from './dto/resident-login.dto';
import { EmployeeLoginDto } from './dto/employee-login.dto';
import { JwtPayload } from '../common/interfaces/jwt-payload.interface';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(Resident)
    private residentsRepository: Repository<Resident>,
    @InjectRepository(Employee)
    private employeesRepository: Repository<Employee>,
    private jwtService: JwtService,
  ) {}

  async loginResident(dto: ResidentLoginDto) {
    const resident = await this.residentsRepository.findOne({
      where: [{ email: dto.identifier }, { document: dto.identifier }],
      relations: ['residentType'],
      select: {
        id: true,
        name: true,
        lastName: true,
        email: true,
        document: true,
        isActive: true,
        passwordHash: true,
        residentType: { id: true, code: true, name: true },
      },
    });

    if (!resident || !resident.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isValid = await bcrypt.compare(dto.password, resident.passwordHash);
    if (!isValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const payload: JwtPayload = { sub: resident.id, type: 'resident' };
    return {
      accessToken: this.jwtService.sign(payload),
      user: {
        id: resident.id,
        name: resident.name,
        lastName: resident.lastName,
        email: resident.email,
        type: 'resident',
        residentType: resident.residentType?.code,
      },
    };
  }

  async loginEmployee(dto: EmployeeLoginDto) {
    const employee = await this.employeesRepository.findOne({
      where: { username: dto.username },
      relations: ['role'],
      select: {
        id: true,
        name: true,
        lastName: true,
        username: true,
        isActive: true,
        passwordHash: true,
        role: { id: true, code: true, name: true },
      },
    });

    if (!employee || !employee.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isValid = await bcrypt.compare(dto.password, employee.passwordHash);
    if (!isValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const payload: JwtPayload = {
      sub: employee.id,
      type: 'employee',
      role: employee.role?.code,
    };
    return {
      accessToken: this.jwtService.sign(payload),
      user: {
        id: employee.id,
        name: employee.name,
        lastName: employee.lastName,
        username: employee.username,
        type: 'employee',
        role: employee.role?.code,
      },
    };
  }
}
