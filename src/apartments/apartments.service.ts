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

  private async attachResidentCounts(apartments: Apartment[]): Promise<Apartment[]> {
    if (apartments.length === 0) return apartments;
    const rows: { apartment_id: string; count: string }[] = await this.repository.query(
      `SELECT apartment_id, COUNT(*) AS count FROM residents WHERE apartment_id IS NOT NULL GROUP BY apartment_id`,
    );
    const countMap = new Map(rows.map((r) => [r.apartment_id, parseInt(r.count, 10)]));
    return apartments.map((apt) => ({ ...apt, residentCount: countMap.get(apt.id) ?? 0 }));
  }

  async findAll(towerId?: string): Promise<Apartment[]> {
    const apartments = await this.repository.find({
      where: towerId ? { towerId } : undefined,
      relations: ['towerData'],
      order: { tower: 'ASC', number: 'ASC' },
    });
    return this.attachResidentCounts(apartments);
  }

  async getStats(): Promise<{ total: number; occupied: number }> {
    const [total, occupiedRows] = await Promise.all([
      this.repository.count(),
      this.repository.query(
        'SELECT COUNT(DISTINCT apartment_id)::int AS occupied FROM residents WHERE apartment_id IS NOT NULL',
      ),
    ]);
    const occupied = Number(occupiedRows?.[0]?.occupied ?? 0);
    return { total, occupied };
  }

  async findOne(id: string): Promise<Apartment> {
    const item = await this.repository.findOne({ where: { id }, relations: ['towerData'] });
    if (!item) throw new NotFoundException(`Apartment #${id} not found`);
    const [withCount] = await this.attachResidentCounts([item]);
    return withCount;
  }

  async create(dto: CreateApartmentDto): Promise<Apartment> {
    const tower = await this.towersRepository.findOne({ where: { id: dto.towerId } });
    if (!tower) throw new NotFoundException(`Tower #${dto.towerId} not found`);

    const item = this.repository.create({ ...dto, tower: tower.code });
    try {
      const saved = await this.repository.save(item);
      return this.findOne(saved.id);
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
    await this.repository.save(item);
    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    const item = await this.findOne(id);
    await this.repository.remove(item);
  }
}
