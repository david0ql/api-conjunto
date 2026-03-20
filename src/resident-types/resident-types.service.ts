import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { ResidentType } from './entities/resident-type.entity';
import { CreateResidentTypeDto } from './dto/create-resident-type.dto';
import { UpdateResidentTypeDto } from './dto/update-resident-type.dto';

@Injectable()
export class ResidentTypesService {
  private readonly CACHE_TTL = 3600000;

  constructor(
    @InjectRepository(ResidentType)
    private repository: Repository<ResidentType>,
    @Inject(CACHE_MANAGER)
    private cacheManager: Cache,
  ) {}

  async findAll(): Promise<ResidentType[]> {
    const cached = await this.cacheManager.get<ResidentType[]>('resident_types');
    if (cached) return cached;
    const data = await this.repository.find();
    await this.cacheManager.set('resident_types', data, this.CACHE_TTL);
    return data;
  }

  async findOne(id: string): Promise<ResidentType> {
    const cacheKey = `resident_type_${id}`;
    const cached = await this.cacheManager.get<ResidentType>(cacheKey);
    if (cached) return cached;
    const item = await this.repository.findOne({ where: { id } });
    if (!item) throw new NotFoundException(`ResidentType #${id} not found`);
    await this.cacheManager.set(cacheKey, item, this.CACHE_TTL);
    return item;
  }

  async create(dto: CreateResidentTypeDto): Promise<ResidentType> {
    const item = this.repository.create(dto);
    const saved = await this.repository.save(item);
    await this.cacheManager.del('resident_types');
    return saved;
  }

  async update(id: string, dto: UpdateResidentTypeDto): Promise<ResidentType> {
    const item = await this.findOne(id);
    Object.assign(item, dto);
    const saved = await this.repository.save(item);
    await this.cacheManager.del('resident_types');
    await this.cacheManager.del(`resident_type_${id}`);
    return saved;
  }

  async remove(id: string): Promise<void> {
    const item = await this.findOne(id);
    await this.repository.remove(item);
    await this.cacheManager.del('resident_types');
    await this.cacheManager.del(`resident_type_${id}`);
  }
}
