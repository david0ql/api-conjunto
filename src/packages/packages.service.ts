import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Package } from './entities/package.entity';
import { PackagePhoto } from './entities/package-photo.entity';
import { CreatePackageDto } from './dto/create-package.dto';
import { UpdatePackageDto } from './dto/update-package.dto';

@Injectable()
export class PackagesService {
  constructor(
    @InjectRepository(Package)
    private repository: Repository<Package>,
    @InjectRepository(PackagePhoto)
    private photoRepository: Repository<PackagePhoto>,
  ) {}

  async findAll(): Promise<Package[]> {
    return this.repository
      .createQueryBuilder('pkg')
      .leftJoinAndSelect('pkg.apartment', 'apartment')
      .leftJoinAndSelect('apartment.towerData', 'towerData')
      .leftJoinAndSelect('pkg.resident', 'resident')
      .leftJoinAndSelect('pkg.createdByEmployee', 'createdByEmployee')
      .leftJoinAndSelect('pkg.receivedByResident', 'receivedByResident')
      .leftJoinAndSelect('pkg.deliveredByEmployee', 'deliveredByEmployee')
      .loadRelationCountAndMap('pkg.photoCount', 'pkg.photos')
      .orderBy('pkg.arrivalTime', 'DESC')
      .getMany();
  }

  async findOne(id: string): Promise<Package> {
    const item = await this.repository.findOne({
      where: { id },
      relations: ['apartment', 'apartment.towerData', 'resident', 'createdByEmployee', 'receivedByResident', 'deliveredByEmployee'],
    });
    if (!item) throw new NotFoundException(`Package #${id} not found`);
    return item;
  }

  async findByResident(residentId: string): Promise<Package[]> {
    return this.repository
      .createQueryBuilder('pkg')
      .leftJoinAndSelect('pkg.apartment', 'apartment')
      .leftJoinAndSelect('apartment.towerData', 'towerData')
      .leftJoinAndSelect('pkg.createdByEmployee', 'createdByEmployee')
      .leftJoinAndSelect('pkg.receivedByResident', 'receivedByResident')
      .leftJoinAndSelect('pkg.deliveredByEmployee', 'deliveredByEmployee')
      .where('pkg.resident_id = :residentId', { residentId })
      .loadRelationCountAndMap('pkg.photoCount', 'pkg.photos')
      .orderBy('pkg.arrivalTime', 'DESC')
      .getMany();
  }

  async create(dto: CreatePackageDto, photoPaths: string[] = []): Promise<Package> {
    const item = this.repository.create(dto);
    const saved = await this.repository.save(item);

    if (photoPaths.length > 0) {
      await this.photoRepository.save(
        photoPaths.map((filePath) => this.photoRepository.create({ packageId: saved.id, filePath })),
      );
    }

    return this.findOne(saved.id);
  }

  async update(id: string, dto: UpdatePackageDto): Promise<Package> {
    const item = await this.findOne(id);
    Object.assign(item, dto);
    return this.repository.save(item);
  }

  async markDelivered(id: string, dto: UpdatePackageDto, deliveredByEmployeeId: string, deliveryPhotoPath?: string): Promise<Package> {
    if (!deliveryPhotoPath) {
      throw new BadRequestException('La foto de entrega es obligatoria');
    }

    const item = await this.findOne(id);
    item.delivered = true;
    item.deliveredTime = new Date();
    item.deliveredByEmployeeId = deliveredByEmployeeId;
    item.deliveryPhotoPath = deliveryPhotoPath;
    if (dto.receivedByResidentId) {
      item.receivedByResidentId = dto.receivedByResidentId;
    }
    await this.repository.save(item);
    return this.findOne(item.id);
  }

  async remove(id: string): Promise<void> {
    const item = await this.findOne(id);
    await this.repository.remove(item);
  }

  async addPhoto(packageId: string, filePath: string): Promise<PackagePhoto> {
    await this.findOne(packageId);
    const photo = this.photoRepository.create({ packageId, filePath });
    return this.photoRepository.save(photo);
  }

  async getPhotos(packageId: string): Promise<PackagePhoto[]> {
    return this.photoRepository.find({
      where: { packageId },
      order: { createdAt: 'ASC' },
    });
  }
}
