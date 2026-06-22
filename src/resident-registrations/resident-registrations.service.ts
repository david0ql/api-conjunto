import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import * as fs from 'fs';
import * as path from 'path';
import { RegistrationLink } from './entities/registration-link.entity';
import { RegistrationRequest } from './entities/registration-request.entity';
import { RegistrationRequestPerson } from './entities/registration-request-person.entity';
import { RegistrationRequestVehicle } from './entities/registration-request-vehicle.entity';
import { Resident } from '../residents/entities/resident.entity';
import { ResidentApartment } from '../resident-apartments/entities/resident-apartment.entity';
import { VehicleBrand } from '../vehicle-brands/entities/vehicle-brand.entity';
import { ResidentVehicle } from '../resident-vehicles/entities/resident-vehicle.entity';
import { Tower } from '../towers/entities/tower.entity';
import { Apartment } from '../apartments/entities/apartment.entity';
import { ResidentType } from '../resident-types/entities/resident-type.entity';
import { MailService } from '../mail/mail.service';

export type ApprovalMode = 'replace' | 'merge';

const PASSWORD_WORDS = ['CASA', 'PISO', 'APTO', 'LLAVE', 'PUERTA'];

function generatePassword(): string {
  const word = PASSWORD_WORDS[Math.floor(Math.random() * PASSWORD_WORDS.length)];
  const num = Math.floor(1000 + Math.random() * 9000);
  return `${word}-${num}`;
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

@Injectable()
export class ResidentRegistrationsService {
  constructor(
    @InjectRepository(RegistrationLink)
    private linksRepo: Repository<RegistrationLink>,
    @InjectRepository(RegistrationRequest)
    private requestsRepo: Repository<RegistrationRequest>,
    @InjectRepository(RegistrationRequestPerson)
    private personsRepo: Repository<RegistrationRequestPerson>,
    @InjectRepository(RegistrationRequestVehicle)
    private vehiclesRepo: Repository<RegistrationRequestVehicle>,
    @InjectRepository(Resident)
    private residentsRepo: Repository<Resident>,
    @InjectRepository(ResidentApartment)
    private residentApartmentsRepo: Repository<ResidentApartment>,
    @InjectRepository(VehicleBrand)
    private vehicleBrandsRepo: Repository<VehicleBrand>,
    @InjectRepository(ResidentVehicle)
    private residentVehiclesRepo: Repository<ResidentVehicle>,
    @InjectRepository(Tower)
    private towersRepo: Repository<Tower>,
    @InjectRepository(Apartment)
    private apartmentsRepo: Repository<Apartment>,
    @InjectRepository(ResidentType)
    private residentTypesRepo: Repository<ResidentType>,
    private readonly mailService: MailService,
  ) {}

  private apartmentLabel(request: RegistrationRequest): string | undefined {
    const apt = (request as any).apartment;
    const tower = (request as any).tower;
    const parts: string[] = [];
    if (tower?.name || tower?.code) parts.push(`Torre ${tower.name ?? tower.code}`);
    if (apt?.number) parts.push(`Apto ${apt.number}`);
    return parts.length ? parts.join(' · ') : undefined;
  }

  // ─── Links ────────────────────────────────────────────────────────────────

  findAllLinks(): Promise<RegistrationLink[]> {
    return this.linksRepo.find({ order: { createdAt: 'DESC' } });
  }

  async createLink(
    dto: { label: string; geofenceLat: number; geofenceLng: number; geofenceRadiusM: number },
    employeeId: string,
  ): Promise<RegistrationLink> {
    const link = this.linksRepo.create({ ...dto, createdByEmployeeId: employeeId });
    return this.linksRepo.save(link);
  }

  async toggleLink(id: string): Promise<RegistrationLink> {
    const link = await this.linksRepo.findOne({ where: { id } });
    if (!link) throw new NotFoundException('Link not found');
    await this.linksRepo.update(id, { isActive: !link.isActive });
    return this.linksRepo.findOne({ where: { id } }) as Promise<RegistrationLink>;
  }

  async deleteLink(id: string): Promise<void> {
    const link = await this.linksRepo.findOne({ where: { id } });
    if (!link) throw new NotFoundException('Link not found');
    await this.linksRepo.remove(link);
  }

  // ─── Public link info ─────────────────────────────────────────────────────

  async getPublicLink(publicId: string) {
    const link = await this.linksRepo.findOne({ where: { publicId, isActive: true } });
    if (!link) throw new NotFoundException('Enlace no válido o inactivo');

    const towers = await this.towersRepo.find({ order: { code: 'ASC' } });
    const apartments = await this.apartmentsRepo.find({ order: { number: 'ASC' } });
    const residentTypes = await this.residentTypesRepo.find({ order: { name: 'ASC' } });
    const vehicleBrands = await this.vehicleBrandsRepo.find({ order: { name: 'ASC' } });

    return {
      label: link.label,
      geofenceLat: link.geofenceLat,
      geofenceLng: link.geofenceLng,
      geofenceRadiusM: link.geofenceRadiusM,
      towers,
      apartments,
      residentTypes,
      vehicleBrands,
    };
  }

  // ─── Requests ─────────────────────────────────────────────────────────────

  async findAllRequests(filters: { status?: string; linkId?: string; apartmentId?: string }) {
    const qb = this.requestsRepo
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.tower', 'tower')
      .leftJoinAndSelect('r.apartment', 'apartment')
      .leftJoinAndSelect('r.persons', 'persons')
      .leftJoinAndSelect('r.vehicles', 'vehicles')
      .orderBy('r.submitted_at', 'DESC');

    if (filters.status) qb.andWhere('r.status = :status', { status: filters.status });
    if (filters.linkId) qb.andWhere('r.link_id = :linkId', { linkId: filters.linkId });
    if (filters.apartmentId) qb.andWhere('r.apartment_id = :apartmentId', { apartmentId: filters.apartmentId });

    return qb.getMany();
  }

  async findOneRequest(id: string): Promise<RegistrationRequest> {
    const request = await this.requestsRepo.findOne({
      where: { id },
      relations: ['tower', 'apartment', 'persons', 'vehicles'],
    });
    if (!request) throw new NotFoundException('Request not found');
    return request;
  }

  async submitRequest(
    publicId: string,
    dto: {
      towerId: string;
      apartmentId: string;
      submittedLat?: number;
      submittedLng?: number;
      persons: Array<{
        name: string;
        lastName: string;
        document: string;
        phone?: string;
        email?: string;
        birthDate?: string;
        isOwner: boolean;
        sortOrder?: number;
        photoPath?: string;
      }>;
      vehicles?: Array<{
        vehicleType: string;
        brandName: string;
        model?: string;
        color?: string;
        plate: string;
        notes?: string;
      }>;
      receiptPhotoPath?: string;
    },
  ): Promise<RegistrationRequest> {
    const link = await this.linksRepo.findOne({ where: { publicId, isActive: true } });
    if (!link) throw new NotFoundException('Enlace no válido o inactivo');

    if (dto.submittedLat !== undefined && dto.submittedLng !== undefined) {
      const distKm = haversineKm(link.geofenceLat, link.geofenceLng, dto.submittedLat, dto.submittedLng);
      const distM = distKm * 1000;
      if (distM > link.geofenceRadiusM) {
        throw new BadRequestException(
          `Fuera de la geocerca permitida. Distancia: ${Math.round(distM)}m, máximo: ${link.geofenceRadiusM}m`,
        );
      }
    }

    this.validateSubmittedRequest(dto);

    const request = this.requestsRepo.create({
      linkId: link.id,
      towerId: dto.towerId,
      apartmentId: dto.apartmentId,
      submittedLat: dto.submittedLat,
      submittedLng: dto.submittedLng,
      receiptPhotoPath: dto.receiptPhotoPath,
      status: 'pending',
    });
    const saved = await this.requestsRepo.save(request);

    for (let i = 0; i < dto.persons.length; i++) {
      const p = dto.persons[i];
      await this.personsRepo.save(
        this.personsRepo.create({ ...p, requestId: saved.id, sortOrder: p.sortOrder ?? i }),
      );
    }

    for (const v of dto.vehicles ?? []) {
      await this.vehiclesRepo.save(this.vehiclesRepo.create({ ...v, requestId: saved.id }));
    }

    return this.findOneRequest(saved.id);
  }

  private validateSubmittedRequest(dto: {
    towerId: string;
    apartmentId: string;
    persons: Array<{
      name: string;
      lastName: string;
      document: string;
      phone?: string;
      email?: string;
      birthDate?: string;
      isOwner: boolean;
      photoPath?: string;
    }>;
    vehicles?: Array<{
      vehicleType: string;
      brandName: string;
      model?: string;
      color?: string;
      plate: string;
    }>;
    receiptPhotoPath?: string;
  }) {
    if (!dto.towerId?.trim() || !dto.apartmentId?.trim()) {
      throw new BadRequestException('Debes seleccionar torre y apartamento');
    }

    if (!dto.receiptPhotoPath?.trim()) {
      throw new BadRequestException('Debes adjuntar la foto del recibo de administración');
    }

    if (!dto.persons.length || !dto.persons.some((person) => person.isOwner)) {
      throw new BadRequestException('Debes registrar al menos un propietario');
    }

    const incompletePersonIndex = dto.persons.findIndex((person) =>
      !person.name?.trim() ||
      !person.lastName?.trim() ||
      !person.document?.trim() ||
      !person.phone?.trim() ||
      !person.email?.trim() ||
      !isValidEmail(person.email) ||
      !person.birthDate?.trim() ||
      !person.photoPath?.trim(),
    );
    if (incompletePersonIndex >= 0) {
      throw new BadRequestException(
        `Completa todos los datos del residente ${incompletePersonIndex + 1}`,
      );
    }

    const incompleteVehicleIndex = (dto.vehicles ?? []).findIndex((vehicle) =>
      !vehicle.vehicleType?.trim() ||
      !vehicle.brandName?.trim() ||
      !vehicle.plate?.trim() ||
      !vehicle.model?.trim() ||
      !vehicle.color?.trim(),
    );
    if (incompleteVehicleIndex >= 0) {
      throw new BadRequestException(
        `Completa todos los datos del vehículo ${incompleteVehicleIndex + 1}`,
      );
    }
  }

  /**
   * Returns the submitted persons alongside the residents currently linked to the
   * apartment, marking which submitted person matches an existing resident (by document).
   * Lets the admin decide between approving (replace/merge) or rejecting.
   */
  async getApprovalPreview(id: string) {
    const request = await this.findOneRequest(id);

    // Residents currently linked to the apartment (via junction table)
    const currentLinks = await this.residentApartmentsRepo.find({
      where: { apartmentId: request.apartmentId },
    });
    const currentResidentIds = currentLinks.map((l) => l.residentId);
    const currentResidents = currentResidentIds.length
      ? await this.residentsRepo.find({ where: currentResidentIds.map((rid) => ({ id: rid })) })
      : [];

    const submittedDocuments = request.persons.map((p) => p.document?.trim()).filter(Boolean);
    const matchingByDocument = submittedDocuments.length
      ? await this.residentsRepo.find({
          where: submittedDocuments.map((doc) => ({ document: doc })),
        })
      : [];
    const matchByDoc = new Map(matchingByDocument.map((r) => [r.document, r]));

    const toView = (r: Resident) => ({
      id: r.id,
      name: r.name,
      lastName: r.lastName,
      document: r.document,
      phone: r.phone ?? null,
      email: r.email ?? null,
      birthDate: r.birthDate ?? null,
      residentType: (r as any).residentType?.name ?? null,
      isActive: r.isActive,
    });

    // Vehicles currently registered to the apartment
    const currentVehicles = await this.residentVehiclesRepo.find({
      where: { apartmentId: request.apartmentId },
      relations: ['vehicleBrand'],
      order: { createdAt: 'ASC' },
    });

    return {
      requestId: request.id,
      apartmentLabel: this.apartmentLabel(request),
      currentResidents: currentResidents.map(toView),
      currentVehicles: currentVehicles.map((v) => ({
        id: v.id,
        plate: v.plate,
        vehicleType: v.vehicleType,
        brandName: (v as any).vehicleBrand?.name ?? null,
        model: v.model ?? null,
        color: v.color ?? null,
      })),
      submittedPersons: request.persons
        .slice()
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
        .map((p) => {
          const match = matchByDoc.get(p.document?.trim());
          return {
            name: p.name,
            lastName: p.lastName,
            document: p.document,
            phone: p.phone ?? null,
            email: p.email ?? null,
            birthDate: p.birthDate ?? null,
            isOwner: p.isOwner,
            existingResident: match ? toView(match) : null,
          };
        }),
    };
  }

  async rejectRequest(id: string, rejectionReason: string, employeeId: string): Promise<RegistrationRequest> {
    const request = await this.findOneRequest(id);
    if (request.status !== 'pending') throw new BadRequestException('Solo se pueden rechazar solicitudes pendientes');

    await this.requestsRepo.update(id, {
      status: 'rejected',
      rejectionReason,
      reviewedByEmployeeId: employeeId,
      reviewedAt: new Date(),
    });

    // Notify every person in the request about the rejection (non-fatal)
    const apartmentLabel = this.apartmentLabel(request);
    for (const person of request.persons) {
      if (!person.email?.trim()) continue;
      await this.mailService.sendRegistrationRejected(person.email.trim(), {
        name: `${person.name} ${person.lastName}`.trim(),
        reason: rejectionReason,
        apartmentLabel,
      });
    }

    return this.findOneRequest(id);
  }

  async approveRequest(
    id: string,
    employeeId: string,
    mode: ApprovalMode = 'merge',
  ): Promise<{
    residents: Array<{
      name: string;
      document: string;
      email: string | null;
      status: 'created' | 'replaced' | 'merged';
      password?: string;
      emailSent: boolean;
    }>;
  }> {
    const request = await this.findOneRequest(id);
    if (request.status !== 'pending') throw new BadRequestException('Solo se pueden aprobar solicitudes pendientes');

    const apartmentLabel = this.apartmentLabel(request);
    const results: Array<{
      name: string;
      document: string;
      email: string | null;
      status: 'created' | 'replaced' | 'merged';
      password?: string;
      emailSent: boolean;
    }> = [];
    const credentialEmails: Array<{ email: string; name: string; password: string; index: number }> = [];

    // Find owner and tenant resident type IDs
    const allTypes = await this.residentTypesRepo.find({ order: { name: 'ASC' } });
    if (!allTypes.length) throw new BadRequestException('No hay tipos de residente configurados');

    const ownerType = allTypes.find((t) => t.code === 'owner') ?? allTypes.find((t) => t.name?.toLowerCase().includes('propietario'));
    const tenantType = allTypes.find((t) => t.code === 'tenant') ?? allTypes.find((t) => t.name?.toLowerCase().includes('arrendatario'));
    const defaultType = allTypes[0];

    const ownerTypeId = ownerType?.id ?? defaultType.id;
    const tenantTypeId = tenantType?.id ?? defaultType.id;

    // "Replace" mode: disable the accounts of the residents currently linked to the
    // apartment (kept for audit, not deleted). The submitted people become the new
    // occupants. Re-submitted people are re-enabled in the loop below.
    if (mode === 'replace') {
      const currentLinks = await this.residentApartmentsRepo.find({
        where: { apartmentId: request.apartmentId },
      });
      const currentResidentIds = currentLinks.map((l) => l.residentId);
      if (currentResidentIds.length) {
        await this.residentsRepo.update({ id: In(currentResidentIds) }, { isActive: false });
      }
    }

    for (const person of request.persons) {
      const residentTypeId = person.isOwner ? ownerTypeId : tenantTypeId;

      // Check for existing document to avoid duplicates
      const existing = await this.residentsRepo.findOne({ where: { document: person.document } });
      let residentId: string;
      let status: 'created' | 'replaced' | 'merged';
      let password: string | undefined;

      if (existing) {
        residentId = existing.id;

        // Update existing resident according to chosen mode (keep their password)
        const updateData: Partial<Resident> = {};
        if (mode === 'replace') {
          status = 'replaced';
          updateData.name = person.name;
          updateData.lastName = person.lastName;
          updateData.residentTypeId = residentTypeId;
          if (person.phone?.trim()) updateData.phone = person.phone.trim();
          if (person.birthDate?.trim()) updateData.birthDate = person.birthDate;
          if (person.email?.trim()) updateData.email = person.email.trim();
        } else {
          status = 'merged';
          if (!existing.phone && person.phone?.trim()) updateData.phone = person.phone.trim();
          if (!existing.email && person.email?.trim()) updateData.email = person.email.trim();
          if (!existing.birthDate && person.birthDate?.trim()) updateData.birthDate = person.birthDate;
        }
        // A person present in the submission is a confirmed occupant → keep their account enabled
        updateData.isActive = true;
        if (Object.keys(updateData).length) {
          try {
            await this.residentsRepo.update(residentId, updateData as any);
          } catch {
            // Likely a unique email conflict: retry without the email field
            delete (updateData as any).email;
            if (Object.keys(updateData).length) {
              await this.residentsRepo.update(residentId, updateData as any);
            }
          }
        }
      } else {
        status = 'created';
        password = generatePassword();
        const passwordHash = await bcrypt.hash(password, 10);
        const newResident = this.residentsRepo.create({
          name: person.name,
          lastName: person.lastName,
          document: person.document,
          phone: person.phone ?? undefined,
          email: person.email || undefined,
          birthDate: person.birthDate ?? undefined,
          residentTypeId,
          passwordHash,
          isActive: true,
        } as any);
        const savedResident = await this.residentsRepo.save(newResident);
        residentId = (savedResident as any).id as string;
      }

      // Copy photo: always for new/replace; for merge only if the resident has none
      if (person.photoPath) {
        const shouldCopyPhoto = status === 'created' || mode === 'replace' || !existing?.photoPath;
        if (shouldCopyPhoto) {
          try {
            const dest = person.photoPath.replace('registrations/persons', 'residents');
            const destDir = path.dirname(dest);
            if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
            fs.copyFileSync(person.photoPath, dest);
            await this.residentsRepo.update(residentId, { photoPath: dest });
          } catch {
            // Non-fatal: skip photo copy on error
          }
        }
      }

      // Assign apartment
      await this.residentsRepo.query('UPDATE residents SET apartment_id = $1 WHERE id = $2', [request.apartmentId, residentId]);
      const existingJunction = await this.residentApartmentsRepo.findOne({
        where: { residentId, apartmentId: request.apartmentId },
      });
      if (!existingJunction) {
        await this.residentApartmentsRepo.save(
          this.residentApartmentsRepo.create({ residentId, apartmentId: request.apartmentId }),
        );
      }

      const fullName = `${person.name} ${person.lastName}`.trim();
      const personEmail = person.email?.trim() || null;
      if (status === 'created' && personEmail) {
        credentialEmails.push({ email: personEmail, name: fullName, password: password as string, index: results.length });
      }
      results.push({ name: fullName, document: person.document, email: personEmail, status, password, emailSent: false });
    }

    // Create vehicles
    for (const v of request.vehicles) {
      let brand = await this.vehicleBrandsRepo.findOne({ where: { name: v.brandName.trim() } });
      if (!brand) {
        brand = await this.vehicleBrandsRepo.save(this.vehicleBrandsRepo.create({ name: v.brandName.trim() }));
      }

      const plate = v.plate.replace(/\s+/g, '').toUpperCase();
      const existingVehicle = await this.residentVehiclesRepo.findOne({ where: { plate } });
      if (!existingVehicle) {
        await this.residentVehiclesRepo.save(
          this.residentVehiclesRepo.create({
            apartmentId: request.apartmentId,
            vehicleBrandId: brand.id,
            vehicleType: v.vehicleType,
            plate,
            color: v.color?.trim() || undefined,
            model: v.model?.trim() || undefined,
            notes: v.notes?.trim() || undefined,
          }),
        );
      }
    }

    await this.requestsRepo.update(id, {
      status: 'approved',
      reviewedByEmployeeId: employeeId,
      reviewedAt: new Date(),
    });

    // Send credentials to newly created residents (non-fatal)
    for (const c of credentialEmails) {
      const sent = await this.mailService.sendResidentCredentials(c.email, {
        name: c.name,
        loginEmail: c.email,
        password: c.password,
        apartmentLabel,
      });
      results[c.index].emailSent = sent;
    }

    return { residents: results };
  }
}
