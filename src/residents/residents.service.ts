import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import * as QRCode from 'qrcode';
import { Resident } from './entities/resident.entity';
import { CreateResidentDto } from './dto/create-resident.dto';
import { UpdateResidentDto } from './dto/update-resident.dto';
import { ResidentApartment } from '../resident-apartments/entities/resident-apartment.entity';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { PaginatedResponse, paginate } from '../common/dto/paginated-response.dto';
import { periodToStartDate } from '../common/utils/period-filter';

interface ResidentFilters extends PaginationQueryDto {
  search?: string;
  typeId?: string;
  isActive?: string;
  hasApartment?: string;
  towerId?: string;
}

@Injectable()
export class ResidentsService {
  constructor(
    @InjectRepository(Resident)
    private repository: Repository<Resident>,
    @InjectRepository(ResidentApartment)
    private residentApartmentsRepository: Repository<ResidentApartment>,
  ) {}

  async findAll(apartmentId?: string, query: ResidentFilters = {}): Promise<PaginatedResponse<Resident>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 15;
    const qb = this.repository
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.residentType', 'residentType')
      .leftJoinAndSelect('r.apartment', 'apartment')
      .leftJoinAndSelect('apartment.towerData', 'towerData');

    if (apartmentId) {
      qb.andWhere('r.apartment_id = :apartmentId', { apartmentId });
    }
    if (query.search) {
      const q = `%${query.search}%`;
      qb.andWhere('(r.name ILIKE :q OR r.last_name ILIKE :q OR r.document ILIKE :q OR r.email ILIKE :q OR r.phone ILIKE :q OR apartment.number ILIKE :q)', { q });
    }
    if (query.typeId) {
      qb.andWhere('r.resident_type_id = :typeId', { typeId: query.typeId });
    }
    if (query.isActive !== undefined && query.isActive !== '') {
      qb.andWhere('r.is_active = :isActive', { isActive: query.isActive === 'true' });
    }
    if (query.hasApartment === 'yes') {
      qb.andWhere('r.apartment_id IS NOT NULL');
    } else if (query.hasApartment === 'no') {
      qb.andWhere('r.apartment_id IS NULL');
    }
    if (query.towerId) {
      qb.andWhere('apartment.tower_id = :towerId', { towerId: query.towerId });
    }

    const [data, total] = await qb
      .orderBy('r.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();
    return paginate(data, total, page, limit);
  }

  async getStats(): Promise<{ total: number; active: number }> {
    const [total, active] = await Promise.all([
      this.repository.count(),
      this.repository.count({ where: { isActive: true } }),
    ]);
    return { total, active };
  }

  async findOne(id: string): Promise<Resident> {
    const item = await this.repository
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.residentType', 'residentType')
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

  async getQrCode(residentId: string, apartmentId: string): Promise<{ dataUrl: string; residentId: string; apartmentId: string }> {
    const resident = await this.findOne(residentId);
    const payload = JSON.stringify({ residentId: resident.id, apartmentId, type: 'resident-access' });
    const dataUrl = await QRCode.toDataURL(payload, {
      width: 400,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' },
    });
    return { dataUrl, residentId: resident.id, apartmentId };
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
    await this.findOne(id);
    // Clean up non-nullable FK references before deleting
    await this.repository.query('DELETE FROM resident_apartments WHERE resident_id = $1', [id]);
    await this.repository.query('DELETE FROM reservations WHERE resident_id = $1', [id]);
    await this.repository.query('DELETE FROM assembly_votes WHERE resident_id = $1', [id]);
    await this.repository.query('DELETE FROM assembly_resident_tokens WHERE resident_id = $1', [id]);
    // Nullify nullable FK references
    await this.repository.query('UPDATE access_audit SET resident_id = NULL WHERE resident_id = $1', [id]);
    await this.repository.query('UPDATE fines SET resident_id = NULL WHERE resident_id = $1', [id]);
    await this.repository.query('UPDATE packages SET resident_id = NULL WHERE resident_id = $1', [id]);
    await this.repository.query('UPDATE call_sessions SET initiated_by_resident_id = NULL WHERE initiated_by_resident_id = $1', [id]);
    await this.repository.query('UPDATE call_sessions SET accepted_by_resident_id = NULL WHERE accepted_by_resident_id = $1', [id]);
    await this.repository.query('DELETE FROM residents WHERE id = $1', [id]);
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
