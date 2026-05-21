import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ErrorLog } from './entities/error-log.entity';
import { CreateErrorLogDto } from './dto/create-error-log.dto';

@Injectable()
export class ErrorLogsService {
  constructor(
    @InjectRepository(ErrorLog)
    private repository: Repository<ErrorLog>,
  ) {}

  async create(dto: CreateErrorLogDto): Promise<ErrorLog> {
    const entry = this.repository.create(dto);
    return this.repository.save(entry);
  }

  async findAll(page = 1, limit = 50) {
    const [data, total] = await this.repository.findAndCount({
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }
}
