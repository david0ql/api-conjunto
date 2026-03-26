import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import * as QRCode from 'qrcode';
import { Resident } from './entities/resident.entity';
import { CreateResidentDto } from './dto/create-resident.dto';
import { UpdateResidentDto } from './dto/update-resident.dto';
import { ResidentApartment } from '../resident-apartments/entities/resident-apartment.entity';

@Injectable()
export class ResidentsService {
  constructor(
    @InjectRepository(Resident)
    private repository: Repository<Resident>,
    @InjectRepository(ResidentApartment)
    private residentApartmentsRepository: Repository<ResidentApartment>,
  ) {}

  async findAll(apartmentId?: string): Promise<Resident[]> {
    const qb = this.repository
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.apartment', 'apartment')
      .leftJoinAndSelect('apartment.towerData', 'towerData');

    if (apartmentId) {
      qb.where('r.apartment_id = :apartmentId', { apartmentId });
    }

    return qb.getMany();
  }

  async findOne(id: string): Promise<Resident> {
    const item = await this.repository
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.apartment', 'apartment')
      .leftJoinAndSelect('apartment.towerData', 'towerData')
      .where('r.id = :id', { id })
      .getOne();
    if (!item) throw new NotFoundException(`Resident #${id} not found`);
    return item;
  }

  async getMyApartments(residentId: string): Promise<ResidentApartment[]> {
    return this.residentApartmentsRepository.find({
      where: { residentId },
      relations: ['apartment', 'apartment.towerData'],
      order: { createdAt: 'ASC' },
    });
  }

  async hasApartment(residentId: string): Promise<boolean> {
    const resident = await this.repository.findOne({ where: { id: residentId } });
    if (resident?.apartmentId) return true;
    const count = await this.residentApartmentsRepository.count({ where: { residentId } });
    return count > 0;
  }

  async getQrCode(residentId: string): Promise<{ dataUrl: string; residentId: string }> {
    const resident = await this.findOne(residentId);
    const payload = JSON.stringify({ residentId: resident.id, type: 'resident-access' });
    const dataUrl = await QRCode.toDataURL(payload, {
      width: 400,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' },
    });
    return { dataUrl, residentId: resident.id };
  }

  async create(dto: CreateResidentDto): Promise<Resident> {
    const existing = await this.repository.findOne({
      where: [{ email: dto.email }, { document: dto.document }],
    });
    if (existing) throw new ConflictException('Email or document already in use');
    const passwordHash = await bcrypt.hash(dto.password, 10);
    const { password, ...rest } = dto;
    const item = this.repository.create({ ...rest, passwordHash });
    return this.repository.save(item);
  }

  async update(id: string, dto: UpdateResidentDto): Promise<Resident> {
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

  async deactivate(id: string): Promise<Resident> {
    await this.findOne(id);
    await this.repository.update(id, { isActive: false } as any);
    return this.findOne(id);
  }

  async activate(id: string): Promise<Resident> {
    await this.findOne(id);
    await this.repository.update(id, { isActive: true } as any);
    return this.findOne(id);
  }

  async assignApartment(id: string, apartmentId: string): Promise<Resident> {
    await this.findOne(id);
    await this.repository.query(
      'UPDATE residents SET apartment_id = $1 WHERE id = $2',
      [apartmentId, id],
    );
    // Also ensure entry in resident_apartments junction table
    const existing = await this.residentApartmentsRepository.findOne({
      where: { residentId: id, apartmentId },
    });
    if (!existing) {
      await this.residentApartmentsRepository.save(
        this.residentApartmentsRepository.create({ residentId: id, apartmentId }),
      );
    }
    return this.findOne(id);
  }

  async unassignApartment(id: string): Promise<Resident> {
    await this.findOne(id);
    await this.repository.query(
      'UPDATE residents SET apartment_id = NULL WHERE id = $1',
      [id],
    );
    return this.findOne(id);
  }
}
