import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccessAudit } from './entities/access-audit.entity';
import { CreateAccessAuditDto } from './dto/create-access-audit.dto';
import { UpdateAccessAuditDto } from './dto/update-access-audit.dto';

@Injectable()
export class AccessAuditService {
  constructor(
    @InjectRepository(AccessAudit)
    private repository: Repository<AccessAudit>,
  ) {}

  async findAll(): Promise<AccessAudit[]> {
    return this.repository.find({
      relations: ['resident', 'visitor', 'vehicle', 'vehicleBrand', 'apartment', 'authorizedByEmployee'],
      order: { entryTime: 'DESC' },
    });
  }

  async findOne(id: string): Promise<AccessAudit> {
    const item = await this.repository.findOne({
      where: { id },
      relations: ['resident', 'visitor', 'vehicle', 'vehicleBrand', 'apartment', 'authorizedByEmployee'],
    });
    if (!item) throw new NotFoundException(`AccessAudit #${id} not found`);
    return item;
  }

  async create(dto: CreateAccessAuditDto): Promise<AccessAudit> {
    const entryType = dto.entryType ?? 'pedestrian';
    const needsVehicleData = entryType === 'car' || entryType === 'motorcycle';

    if (!dto.visitorId && !dto.residentId) {
      throw new BadRequestException('Debe indicar visitante o residente');
    }

    if (dto.visitorId && !dto.visitorPhotoPath) {
      throw new BadRequestException('La foto del visitante es obligatoria');
    }

    if (needsVehicleData) {
      if (!dto.vehicleBrandId || !dto.vehicleColor || !dto.vehicleModel || !dto.vehiclePlate) {
        throw new BadRequestException(
          'Para carro o moto debes registrar marca, color, placa y modelo',
        );
      }
    }

    const item = this.repository.create({
      ...dto,
      entryType,
      vehicleBrandId: needsVehicleData ? dto.vehicleBrandId : null,
      vehicleColor: needsVehicleData ? dto.vehicleColor?.trim() : null,
      vehicleModel: needsVehicleData ? dto.vehicleModel?.trim() : null,
      vehiclePlate: needsVehicleData ? dto.vehiclePlate?.trim().toUpperCase() : null,
    });

    return this.repository.save(item);
  }

  async update(id: string, dto: UpdateAccessAuditDto): Promise<AccessAudit> {
    const item = await this.findOne(id);
    Object.assign(item, dto);
    return this.repository.save(item);
  }

  async registerExit(id: string): Promise<AccessAudit> {
    const item = await this.findOne(id);
    item.exitTime = new Date();
    return this.repository.save(item);
  }

  async findByApartment(apartmentId: string): Promise<AccessAudit[]> {
    return this.repository.find({
      where: { apartmentId },
      relations: ['resident', 'visitor', 'vehicle', 'vehicleBrand', 'apartment', 'authorizedByEmployee'],
      order: { entryTime: 'DESC' },
    });
  }

  async remove(id: string): Promise<void> {
    const item = await this.findOne(id);
    await this.repository.remove(item);
  }
}
