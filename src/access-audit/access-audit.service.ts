import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccessAudit } from './entities/access-audit.entity';
import { CreateAccessAuditDto } from './dto/create-access-audit.dto';
import { UpdateAccessAuditDto } from './dto/update-access-audit.dto';

@Injectable()
export class AccessAuditService {
  constructor(
    @InjectRepository(AccessAudit)
    private repository: Repository<AccessAudit>,
  ) {}

  async findAll(): Promise<AccessAudit[]> {
    return this.repository.find({
      relations: ['resident', 'visitor', 'vehicle', 'apartment', 'authorizedByEmployee'],
    });
  }

  async findOne(id: string): Promise<AccessAudit> {
    const item = await this.repository.findOne({
      where: { id },
      relations: ['resident', 'visitor', 'vehicle', 'apartment', 'authorizedByEmployee'],
    });
    if (!item) throw new NotFoundException(`AccessAudit #${id} not found`);
    return item;
  }

  async create(dto: CreateAccessAuditDto): Promise<AccessAudit> {
    const item = this.repository.create(dto);
    return this.repository.save(item);
  }

  async update(id: string, dto: UpdateAccessAuditDto): Promise<AccessAudit> {
    const item = await this.findOne(id);
    Object.assign(item, dto);
    return this.repository.save(item);
  }

  async registerExit(id: string): Promise<AccessAudit> {
    const item = await this.findOne(id);
    item.exitTime = new Date();
    return this.repository.save(item);
  }

  async remove(id: string): Promise<void> {
    const item = await this.findOne(id);
    await this.repository.remove(item);
  }
}
