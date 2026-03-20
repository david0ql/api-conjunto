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
      user: this.buildResidentSession(resident),
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
      user: this.buildEmployeeSession(employee),
    };
  }

  async getSession(payload: JwtPayload) {
    if (payload.type === 'resident') {
      const resident = await this.residentsRepository.findOne({
        where: { id: payload.sub },
        relations: ['residentType'],
        select: {
          id: true,
          name: true,
          lastName: true,
          email: true,
          document: true,
          phone: true,
          isActive: true,
          createdAt: true,
          residentType: { id: true, code: true, name: true },
        },
      });

      if (!resident || !resident.isActive) {
        throw new UnauthorizedException('Session is no longer valid');
      }

      return this.buildResidentSession(resident);
    }

    const employee = await this.employeesRepository.findOne({
      where: { id: payload.sub },
      relations: ['role'],
      select: {
        id: true,
        name: true,
        lastName: true,
        document: true,
        username: true,
        isActive: true,
        createdAt: true,
        role: { id: true, code: true, name: true },
      },
    });

    if (!employee || !employee.isActive) {
      throw new UnauthorizedException('Session is no longer valid');
    }

    return this.buildEmployeeSession(employee);
  }

  private buildResidentSession(resident: Partial<Resident> & { residentType?: Resident['residentType'] }) {
    return {
      id: resident.id,
      name: resident.name,
      lastName: resident.lastName,
      email: resident.email,
      document: resident.document,
      phone: resident.phone,
      createdAt: resident.createdAt,
      type: 'resident' as const,
      residentType: resident.residentType?.code,
      residentTypeLabel: resident.residentType?.name,
      permissions: [
        'resident:dashboard',
        'resident:profile',
        'reservation:create',
        'reservation:read:own',
        'notification:read:own',
        'package:read:own',
      ],
    };
  }

  private buildEmployeeSession(employee: Partial<Employee> & { role?: Employee['role'] }) {
    const role = employee.role?.code;

    return {
      id: employee.id,
      name: employee.name,
      lastName: employee.lastName,
      document: employee.document,
      username: employee.username,
      createdAt: employee.createdAt,
      type: 'employee' as const,
      role,
      roleLabel: employee.role?.name,
      permissions: this.getEmployeePermissions(role),
    };
  }

  private getEmployeePermissions(role?: string) {
    const common = ['employee:dashboard'];

    switch (role) {
      case 'administrator':
        return [
          ...common,
          'admin:*',
          'resident:manage',
          'employee:manage',
          'apartment:manage',
          'reservation:manage',
          'notification:manage',
          'package:manage',
          'access-audit:manage',
          'pool-entry:manage',
        ];
      case 'porter':
        return [
          ...common,
          'visitor:manage',
          'access-audit:manage',
          'package:manage',
        ];
      case 'pool_attendant':
        return [
          ...common,
          'pool-entry:manage',
          'resident:read',
        ];
      default:
        return common;
    }
  }
}
