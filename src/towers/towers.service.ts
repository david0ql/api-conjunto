import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tower } from './entities/tower.entity';
import { CreateTowerDto } from './dto/create-tower.dto';
import { Apartment } from '../apartments/entities/apartment.entity';

@Injectable()
export class TowersService {
  constructor(
    @InjectRepository(Tower)
    private towersRepository: Repository<Tower>,
    @InjectRepository(Apartment)
    private apartmentsRepository: Repository<Apartment>,
  ) {}

  async findAll() {
    return this.towersRepository.find({
      where: { isActive: true },
      order: { code: 'ASC' },
    });
  }

  async create(dto: CreateTowerDto) {
    const tower = this.towersRepository.create({
      code: dto.code.trim().toUpperCase(),
      name: dto.name.trim(),
      totalFloors: dto.totalFloors,
      apartmentsPerFloor: dto.apartmentsPerFloor,
    });

    try {
      const savedTower = await this.towersRepository.save(tower);
      await this.generateApartments(savedTower);
      return this.towersRepository.findOneByOrFail({ id: savedTower.id });
    } catch (error: any) {
      if (error?.code === '23505') {
        throw new ConflictException('A tower with this code already exists');
      }
      throw error;
    }
  }

  private async generateApartments(tower: Tower) {
    const apartments: Apartment[] = [];

    for (let floor = 1; floor <= tower.totalFloors; floor += 1) {
      for (let index = 1; index <= tower.apartmentsPerFloor; index += 1) {
        const suffix = String(index).padStart(2, '0');
        const number = `${floor}${suffix}`;
        apartments.push(
          this.apartmentsRepository.create({
            number,
            floor,
            tower: tower.code,
            towerId: tower.id,
          }),
        );
      }
    }

    await this.apartmentsRepository.save(apartments);
  }
}
