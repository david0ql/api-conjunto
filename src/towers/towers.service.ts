import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tower } from './entities/tower.entity';
import { CreateTowerDto } from './dto/create-tower.dto';
import { Apartment } from '../apartments/entities/apartment.entity';
import { ApartmentStatus } from '../apartment-statuses/entities/apartment-status.entity';

@Injectable()
export class TowersService {
  constructor(
    @InjectRepository(Tower)
    private towersRepository: Repository<Tower>,
    @InjectRepository(Apartment)
    private apartmentsRepository: Repository<Apartment>,
    @InjectRepository(ApartmentStatus)
    private apartmentStatusesRepository: Repository<ApartmentStatus>,
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
      const apartmentStatusId = await this.resolveApartmentStatusId(dto.apartmentStatusId);
      await this.generateApartments(savedTower, apartmentStatusId);
      return this.towersRepository.findOneByOrFail({ id: savedTower.id });
    } catch (error: any) {
      if (error?.code === '23505') {
        throw new ConflictException('A tower with this code already exists');
      }

      throw error;
    }
  }

  private async resolveApartmentStatusId(apartmentStatusId?: string) {
    if (apartmentStatusId) {
      return apartmentStatusId;
    }

    const vacantStatus = await this.apartmentStatusesRepository.findOne({
      where: { code: 'vacant' },
    });

    if (!vacantStatus) {
      throw new NotFoundException('Vacant apartment status not found');
    }

    return vacantStatus.id;
  }

  private async generateApartments(tower: Tower, statusId: string) {
    const apartments: Apartment[] = [];

    for (let floor = 1; floor <= tower.totalFloors; floor += 1) {
      for (let index = 1; index <= tower.apartmentsPerFloor; index += 1) {
        const suffix = String(index).padStart(2, '0');
        const number = `${floor}${suffix}`;
        apartments.push(
          this.apartmentsRepository.create({
            number,
            floor,
            statusId,
            tower: tower.code,
            towerId: tower.id,
          }),
        );
      }
    }

    await this.apartmentsRepository.save(apartments);
  }
}
