import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { Employee } from './entities/employee.entity';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { PaginatedResponse, paginate } from '../common/dto/paginated-response.dto';

interface EmployeeFilters extends PaginationQueryDto {
  search?: string;
  roleId?: string;
  isActive?: string;
}

@Injectable()
export class EmployeesService {
  constructor(
    @InjectRepository(Employee)
    private repository: Repository<Employee>,
  ) {}

  async findAll(query: EmployeeFilters = {}): Promise<PaginatedResponse<Employee>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 15;
    const qb = this.repository.createQueryBuilder('e').leftJoinAndSelect('e.role', 'role');

    if (query.search) {
      const q = `%${query.search}%`;
      qb.andWhere('(e.name ILIKE :q OR e.last_name ILIKE :q OR e.username ILIKE :q OR e.document ILIKE :q)', { q });
    }
    if (query.roleId) {
      qb.andWhere('e.role_id = :roleId', { roleId: query.roleId });
    }
    if (query.isActive !== undefined && query.isActive !== '') {
      qb.andWhere('e.is_active = :isActive', { isActive: query.isActive === 'true' });
    }

    const [data, total] = await qb.orderBy('e.createdAt', 'DESC').skip((page - 1) * limit).take(limit).getManyAndCount();
    return paginate(data, total, page, limit);
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
    // Reject a username already taken by a different employee.
    if (data.username && data.username !== item.username) {
      const clash = await this.repository.findOne({ where: { username: data.username } });
      if (clash && clash.id !== id) {
        throw new ConflictException('Username already in use');
      }
    }
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
