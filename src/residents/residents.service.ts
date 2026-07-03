import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
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

    // A resident can be linked to an apartment either through the legacy
    // residents.apartment_id column or through the resident_apartments junction
    // (multi-apartment). Every apartment filter below matches EITHER source.
    if (apartmentId) {
      qb.andWhere(
        '(r.apartment_id = :apartmentId OR EXISTS (SELECT 1 FROM resident_apartments ra WHERE ra.resident_id = r.id AND ra.apartment_id = :apartmentId))',
        { apartmentId },
      );
    }
    if (query.search) {
      const q = `%${query.search}%`;
      qb.andWhere(
        '(r.name ILIKE :q OR r.last_name ILIKE :q OR r.document ILIKE :q OR r.email ILIKE :q OR r.phone ILIKE :q OR apartment.number ILIKE :q OR EXISTS (SELECT 1 FROM resident_apartments ra JOIN apartments raa ON raa.id = ra.apartment_id WHERE ra.resident_id = r.id AND raa.number ILIKE :q))',
        { q },
      );
    }
    if (query.typeId) {
      qb.andWhere('r.resident_type_id = :typeId', { typeId: query.typeId });
    }
    // Inactive (soft-deleted) residents are hidden by default so they don't
    // clutter the directory. They remain retrievable for auditing by explicitly
    // requesting isActive=false. Pass isActive=all to list everyone.
    if (query.isActive === undefined || query.isActive === '') {
      qb.andWhere('r.is_active = true');
    } else if (query.isActive !== 'all') {
      qb.andWhere('r.is_active = :isActive', { isActive: query.isActive === 'true' });
    }
    if (query.hasApartment === 'yes') {
      qb.andWhere('(r.apartment_id IS NOT NULL OR EXISTS (SELECT 1 FROM resident_apartments ra WHERE ra.resident_id = r.id))');
    } else if (query.hasApartment === 'no') {
      qb.andWhere('r.apartment_id IS NULL AND NOT EXISTS (SELECT 1 FROM resident_apartments ra WHERE ra.resident_id = r.id)');
    }
    if (query.towerId) {
      qb.andWhere(
        '(apartment.tower_id = :towerId OR EXISTS (SELECT 1 FROM resident_apartments ra JOIN apartments raa ON raa.id = ra.apartment_id WHERE ra.resident_id = r.id AND raa.tower_id = :towerId))',
        { towerId: query.towerId },
      );
    }

    const [data, total] = await qb
      .orderBy('r.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();
    await this.attachApartments(data);
    await this.attachPhotos(data);
    return paginate(data, total, page, limit);
  }

  /**
   * For residents that don't have their own photo, falls back to the photo
   * captured in their registration request (matched by document). Lets the
   * residents list show a face even before an explicit resident photo is set.
   */
  private async attachPhotos(residents: Resident[]): Promise<void> {
    const missing = residents.filter((r) => !r.photoPath && r.document);
    if (missing.length === 0) return;
    const documents = missing.map((r) => r.document);
    const rows: { document: string; photo_path: string }[] = await this.repository.query(
      `SELECT DISTINCT ON (document) document, photo_path
         FROM registration_request_persons
        WHERE photo_path IS NOT NULL AND photo_path <> '' AND document = ANY($1)
        ORDER BY document`,
      [documents],
    );
    const byDocument = new Map(rows.map((row) => [row.document, row.photo_path]));
    for (const r of missing) {
      const photo = byDocument.get(r.document);
      if (photo) r.photoPath = photo;
    }
  }

  /**
   * Attaches an `apartments` array to each resident, merging the junction
   * (resident_apartments) with the legacy residents.apartment_id column and
   * de-duplicating by apartment id. Residents that only have the legacy column
   * (the vast majority of existing data) still get their apartment listed.
   */
  private async attachApartments(residents: Resident[]): Promise<void> {
    if (residents.length === 0) return;
    const ids = residents.map((r) => r.id);
    const links = await this.residentApartmentsRepository.find({
      where: { residentId: In(ids) },
      relations: ['apartment', 'apartment.towerData'],
      order: { createdAt: 'ASC' },
    });
    const byResident = new Map<string, any[]>();
    for (const link of links) {
      if (!link.apartment) continue;
      const list = byResident.get(link.residentId) ?? [];
      list.push(link.apartment);
      byResident.set(link.residentId, list);
    }
    for (const r of residents) {
      const list = byResident.get(r.id) ?? [];
      // Fold in the legacy primary apartment if it isn't already present.
      if (r.apartment && !list.some((a) => a.id === r.apartment.id)) {
        list.unshift(r.apartment);
      }
      (r as any).apartments = list;
    }
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
    await this.attachApartments([item]);
    await this.attachPhotos([item]);
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

  /**
   * Soft-delete: a resident is NEVER physically removed (that would destroy
   * audit history — fines, packages, access logs, votes). Instead the resident
   * is deactivated: they can no longer log in and drop out of the default
   * listing, but remain in the database and are still reachable for auditing
   * via the "Inactivo" filter.
   */
  async remove(id: string): Promise<void> {
    await this.findOne(id);
    await this.repository.update(id, { isActive: false } as any);
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
