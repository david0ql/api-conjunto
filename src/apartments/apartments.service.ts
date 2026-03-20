import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Apartment } from './entities/apartment.entity';
import { CreateApartmentDto } from './dto/create-apartment.dto';
import { UpdateApartmentDto } from './dto/update-apartment.dto';
import { Tower } from '../towers/entities/tower.entity';

@Injectable()
export class ApartmentsService {
  constructor(
    @InjectRepository(Apartment)
    private repository: Repository<Apartment>,
    @InjectRepository(Tower)
    private towersRepository: Repository<Tower>,
  ) {}

  async findAll(towerId?: string): Promise<Apartment[]> {
    return this.repository.find({
      where: towerId ? { towerId } : undefined,
      relations: ['status', 'towerData'],
      order: { tower: 'ASC', number: 'ASC' },
    });
  }

  async findOne(id: string): Promise<Apartment> {
    const item = await this.repository.findOne({ where: { id }, relations: ['status', 'towerData'] });
    if (!item) throw new NotFoundException(`Apartment #${id} not found`);
    return item;
  }

  async create(dto: CreateApartmentDto): Promise<Apartment> {
    const tower = await this.towersRepository.findOne({ where: { id: dto.towerId } });
    if (!tower) throw new NotFoundException(`Tower #${dto.towerId} not found`);

    const item = this.repository.create({
      ...dto,
      tower: tower.code,
    });
    try {
      return await this.repository.save(item);
    } catch (err: any) {
      if (err?.code === '23505') throw new ConflictException('Apartment with this tower and number already exists');
      throw err;
    }
  }

  async update(id: string, dto: UpdateApartmentDto): Promise<Apartment> {
    const item = await this.findOne(id);
    if (dto.towerId) {
      const tower = await this.towersRepository.findOne({ where: { id: dto.towerId } });
      if (!tower) throw new NotFoundException(`Tower #${dto.towerId} not found`);
      item.towerId = tower.id;
      item.tower = tower.code;
    }

    Object.assign(item, { ...dto, tower: item.tower });
    return this.repository.save(item);
  }

  async remove(id: string): Promise<void> {
    const item = await this.findOne(id);
    await this.repository.remove(item);
  }
}
