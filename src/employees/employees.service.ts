import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { Employee } from './entities/employee.entity';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';

@Injectable()
export class EmployeesService {
  constructor(
    @InjectRepository(Employee)
    private repository: Repository<Employee>,
  ) {}

  async findAll(): Promise<Employee[]> {
    return this.repository.find({ relations: ['role'] });
  }

  async findOne(id: string): Promise<Employee> {
    const item = await this.repository.findOne({ where: { id }, relations: ['role'] });
    if (!item) throw new NotFoundException(`Employee #${id} not found`);
    return item;
  }

  async create(dto: CreateEmployeeDto): Promise<Employee> {
    const existing = await this.repository.findOne({
      where: [{ username: dto.username }, { document: dto.document }],
    });
    if (existing) throw new ConflictException('Username or document already in use');
    const passwordHash = await bcrypt.hash(dto.password, 10);
    const { password, ...rest } = dto;
    const item = this.repository.create({ ...rest, passwordHash });
    return this.repository.save(item);
  }

  async update(id: string, dto: UpdateEmployeeDto): Promise<Employee> {
    const item = await this.findOne(id);
    const data = dto as any;
    if (data.password) {
      (item as any).passwordHash = await bcrypt.hash(data.password, 10);
    }
    const { password: _pw, ...rest } = data;
    Object.assign(item, rest);
    return this.repository.save(item);
  }

  async remove(id: string): Promise<void> {
    const item = await this.findOne(id);
    await this.repository.remove(item);
  }

  async deactivate(id: string): Promise<Employee> {
    await this.findOne(id);
    await this.repository.update(id, { isActive: false } as any);
    return this.findOne(id);
  }

  async activate(id: string): Promise<Employee> {
    await this.findOne(id);
    await this.repository.update(id, { isActive: true } as any);
    return this.findOne(id);
  }
}
