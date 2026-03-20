import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { EmployeeRole } from './entities/employee-role.entity';
import { CreateEmployeeRoleDto } from './dto/create-employee-role.dto';
import { UpdateEmployeeRoleDto } from './dto/update-employee-role.dto';

@Injectable()
export class EmployeeRolesService {
  private readonly CACHE_TTL = 3600000;

  constructor(
    @InjectRepository(EmployeeRole)
    private repository: Repository<EmployeeRole>,
    @Inject(CACHE_MANAGER)
    private cacheManager: Cache,
  ) {}

  async findAll(): Promise<EmployeeRole[]> {
    const cached = await this.cacheManager.get<EmployeeRole[]>('employee_roles');
    if (cached) return cached;
    const data = await this.repository.find();
    await this.cacheManager.set('employee_roles', data, this.CACHE_TTL);
    return data;
  }

  async findOne(id: string): Promise<EmployeeRole> {
    const cacheKey = `employee_role_${id}`;
    const cached = await this.cacheManager.get<EmployeeRole>(cacheKey);
    if (cached) return cached;
    const item = await this.repository.findOne({ where: { id } });
    if (!item) throw new NotFoundException(`EmployeeRole #${id} not found`);
    await this.cacheManager.set(cacheKey, item, this.CACHE_TTL);
    return item;
  }

  async create(dto: CreateEmployeeRoleDto): Promise<EmployeeRole> {
    const item = this.repository.create(dto);
    const saved = await this.repository.save(item);
    await this.cacheManager.del('employee_roles');
    return saved;
  }

  async update(id: string, dto: UpdateEmployeeRoleDto): Promise<EmployeeRole> {
    const item = await this.findOne(id);
    Object.assign(item, dto);
    const saved = await this.repository.save(item);
    await this.cacheManager.del('employee_roles');
    await this.cacheManager.del(`employee_role_${id}`);
    return saved;
  }

  async remove(id: string): Promise<void> {
    const item = await this.findOne(id);
    await this.repository.remove(item);
    await this.cacheManager.del('employee_roles');
    await this.cacheManager.del(`employee_role_${id}`);
  }
}
