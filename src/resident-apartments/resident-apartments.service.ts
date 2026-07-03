import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ResidentApartment } from './entities/resident-apartment.entity';
import { Resident } from '../residents/entities/resident.entity';
import { CreateResidentApartmentDto } from './dto/create-resident-apartment.dto';
import { UpdateResidentApartmentDto } from './dto/update-resident-apartment.dto';

@Injectable()
export class ResidentApartmentsService {
  constructor(
    @InjectRepository(ResidentApartment)
    private repository: Repository<ResidentApartment>,
    @InjectRepository(Resident)
    private residentsRepository: Repository<Resident>,
  ) {}

  async findAll(): Promise<ResidentApartment[]> {
    return this.repository.find({ relations: ['resident', 'apartment'] });
  }

  async findOne(id: string): Promise<ResidentApartment> {
    const item = await this.repository.findOne({
      where: { id },
      relations: ['resident', 'apartment'],
    });
    if (!item) throw new NotFoundException(`ResidentApartment #${id} not found`);
    return item;
  }

  async findByResident(residentId: string): Promise<ResidentApartment[]> {
    return this.repository.find({
      where: { residentId },
      relations: ['apartment'],
    });
  }

  async findByApartment(apartmentId: string): Promise<ResidentApartment[]> {
    return this.repository.find({
      where: { apartmentId },
      relations: ['resident'],
    });
  }

  async create(dto: CreateResidentApartmentDto): Promise<ResidentApartment> {
    // Backfill any legacy single-column apartment into the junction first, so
    // the junction becomes the complete set and nothing is lost when the
    // primary column is later re-synced.
    await this.backfillLegacyApartment(dto.residentId);
    // Avoid duplicating the same resident↔apartment link.
    const existing = await this.repository.findOne({
      where: { residentId: dto.residentId, apartmentId: dto.apartmentId },
    });
    const saved = existing ?? (await this.repository.save(this.repository.create(dto)));
    await this.syncPrimaryApartment(saved.residentId);
    return saved;
  }

  /**
   * If the resident has a legacy residents.apartment_id that has no matching
   * junction row yet, materialize it as a junction row. Makes the junction the
   * authoritative, complete set of the resident's apartments.
   */
  private async backfillLegacyApartment(residentId: string): Promise<void> {
    const resident = await this.residentsRepository.findOne({
      where: { id: residentId },
    });
    if (!resident?.apartmentId) return;
    const already = await this.repository.findOne({
      where: { residentId, apartmentId: resident.apartmentId },
    });
    if (already) return;
    await this.repository.save(
      this.repository.create({ residentId, apartmentId: resident.apartmentId }),
    );
  }

  async update(id: string, dto: UpdateResidentApartmentDto): Promise<ResidentApartment> {
    const item = await this.findOne(id);
    Object.assign(item, dto);
    const saved = await this.repository.save(item);
    await this.syncPrimaryApartment(saved.residentId);
    return saved;
  }

  async remove(id: string): Promise<void> {
    const item = await this.findOne(id);
    const residentId = item.residentId;
    await this.repository.remove(item);
    await this.syncPrimaryApartment(residentId);
  }

  /**
   * Keeps the legacy residents.apartment_id column in sync with the junction so
   * every consumer that still reads the single column (residents listing filter,
   * QR access, occupancy counts, mobile fallback) keeps working. The most
   * recently linked apartment is treated as the "primary". Because create()
   * backfills any legacy assignment into the junction, an empty junction means
   * the resident genuinely has no apartments, so the column is cleared.
   */
  private async syncPrimaryApartment(residentId: string): Promise<void> {
    const links = await this.repository.find({
      where: { residentId },
      order: { createdAt: 'DESC' },
    });
    await this.residentsRepository.update(residentId, {
      apartmentId: links.length ? links[0].apartmentId : null,
    } as any);
  }
}
