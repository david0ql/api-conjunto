import { Injectable, NotFoundException, ConflictException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, EntityManager } from 'typeorm';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import * as QRCode from 'qrcode';
import { Resident } from './entities/resident.entity';
import { CreateResidentDto } from './dto/create-resident.dto';
import { UpdateResidentDto } from './dto/update-resident.dto';
import { CreateFamilyMemberDto } from './dto/create-family-member.dto';
import { ResidentFromVisitorDto } from './dto/resident-from-visitor.dto';
import { ResidentApartment } from '../resident-apartments/entities/resident-apartment.entity';
import { ResidentType } from '../resident-types/entities/resident-type.entity';
import { ResidentVehicle } from '../resident-vehicles/entities/resident-vehicle.entity';
import { Visitor } from '../visitors/entities/visitor.entity';
import { MailService } from '../mail/mail.service';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { PaginatedResponse, paginate } from '../common/dto/paginated-response.dto';
import { periodToStartDate } from '../common/utils/period-filter';
import { applyTokenSearch, sqlUnaccent } from '../common/utils/search';
import { recordCustomChange, trackedUpdate } from '../change-history/change-recorder';
import { getChangeContext, setChangeReason } from '../change-history/change-context';

interface ResidentFilters extends PaginationQueryDto {
  search?: string;
  typeId?: string;
  isActive?: string;
  hasApartment?: string;
  towerId?: string;
}

/** Residente que ya tiene el correo o la cédula que se quiere usar. */
export interface ResidentConflict {
  id: string;
  name: string;
  lastName: string;
  document: string;
  email: string | null;
  isActive: boolean;
  /** "Torre 9 · Apt. 569, Torre 2 · Apt. 101" o null si no tiene. */
  apartments: string | null;
}

/** Última inhabilitación de un residente inactivo, sacada del historial de cambios. */
export interface ResidentDeactivation {
  at: Date;
  by: string | null;
  reason: string | null;
}

const fullName = (r: { name?: string | null; lastName?: string | null }) =>
  [r.name, r.lastName].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();

function generatePassword(): string {
  return crypto.randomBytes(4).toString('hex');
}

@Injectable()
export class ResidentsService {
  constructor(
    @InjectRepository(Resident)
    private repository: Repository<Resident>,
    @InjectRepository(ResidentApartment)
    private residentApartmentsRepository: Repository<ResidentApartment>,
    @InjectRepository(ResidentType)
    private residentTypesRepository: Repository<ResidentType>,
    @InjectRepository(ResidentVehicle)
    private residentVehiclesRepository: Repository<ResidentVehicle>,
    private mailService: MailService,
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
    // Cada palabra busca en nombre, apellido, documento, correo, teléfono y
    // número de apartamento (legacy o multi-apartamento); todas deben coincidir.
    applyTokenSearch(
      qb,
      query.search,
      ['r.name', 'r.last_name', 'r.document', 'r.email', 'r.phone', 'apartment.number'],
      (p) => [`EXISTS (
        SELECT 1 FROM resident_apartments ra
        JOIN apartments raa ON raa.id = ra.apartment_id
        WHERE ra.resident_id = r.id
          AND ${sqlUnaccent('raa.number')} ILIKE :${p}
      )`],
    );
    if (query.typeId) {
      qb.andWhere('r.resident_type_id = :typeId', { typeId: query.typeId });
    }
    // Inactive (soft-deleted) residents are hidden by default so they don't
    // clutter the directory. Exception: family members created from the mobile
    // app awaiting admin activation (is_active=false, type=family) must appear
    // by default so the admin can approve them. isActive=pending isolates only
    // those pending family members; isActive=false / all behave as before.
    // Al buscar por texto sin filtro de estado salen también los inactivos,
    // para que se puedan encontrar y volver a habilitar.
    const searching = Boolean(query.search?.trim());
    if ((query.isActive === undefined || query.isActive === '') && !searching) {
      qb.andWhere(
        "(r.is_active = true OR (r.is_active = false AND residentType.code = 'family'))",
      );
    } else if (query.isActive === 'pending') {
      qb.andWhere(
        "(r.is_active = false AND residentType.code = 'family')",
      );
    } else if (query.isActive && query.isActive !== 'all') {
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
    await this.attachDeactivations(data);
    return paginate(data, total, page, limit);
  }

  /**
   * A cada residente inactivo le adjunta cuándo, quién y por qué se inhabilitó
   * (último cambio a "Inactivo" en el historial). Los inactivados antes de que
   * existiera el historial quedan sin este dato.
   */
  private async attachDeactivations(residents: Resident[]): Promise<void> {
    const inactive = residents.filter((r) => !r.isActive);
    if (inactive.length === 0) return;
    const rows: { entity_id: string; created_at: Date; actor_name: string | null; reason: string | null }[] =
      await this.repository.query(
        `SELECT DISTINCT ON (entity_id) entity_id, created_at, actor_name, reason
           FROM change_logs
          WHERE entity_type = 'resident'
            AND entity_id = ANY($1)
            AND changes @> '[{"field": "isActive", "to": "Inactivo"}]'::jsonb
          ORDER BY entity_id, created_at DESC`,
        [inactive.map((r) => r.id)],
      );
    const byResident = new Map(rows.map((row) => [row.entity_id, row]));
    for (const r of inactive) {
      const row = byResident.get(r.id);
      (r as any).deactivation = row
        ? ({ at: row.created_at, by: row.actor_name, reason: row.reason } satisfies ResidentDeactivation)
        : null;
    }
  }

  /**
   * Busca otro residente que ya use ese correo (sin importar mayúsculas, como
   * el login) o esa cédula. Incluye inactivos: la restricción única de la BD
   * también los cuenta.
   */
  private async findConflict(
    manager: EntityManager,
    field: 'email' | 'document',
    value: string,
    excludeId?: string,
  ): Promise<ResidentConflict | null> {
    const column = field === 'email' ? 'LOWER(TRIM(r.email)) = LOWER(TRIM($1))' : 'TRIM(r.document) = TRIM($1)';
    const rows: Array<Omit<ResidentConflict, 'lastName' | 'isActive'> & { last_name: string; is_active: boolean }> =
      await manager.query(
        `SELECT r.id, r.name, r.last_name, r.document, r.email, r.is_active,
                (SELECT string_agg(CONCAT_WS(' · ', t.name, 'Apt. ' || a.number), ', ' ORDER BY t.name, a.number)
                   FROM apartments a LEFT JOIN towers t ON t.id = a.tower_id
                  WHERE a.id = r.apartment_id
                     OR a.id IN (SELECT ra.apartment_id FROM resident_apartments ra WHERE ra.resident_id = r.id)
                ) AS apartments
           FROM residents r
          WHERE ${column} AND ($2::uuid IS NULL OR r.id <> $2::uuid)
          ORDER BY r.is_active DESC
          LIMIT 1`,
        [value, excludeId ?? null],
      );
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      lastName: row.last_name,
      document: row.document,
      email: row.email,
      isActive: row.is_active,
      apartments: row.apartments,
    };
  }

  /** 409 que dice quién tiene el dato, para que la web lo muestre tal cual. */
  private conflictError(field: 'email' | 'document', value: string, conflict: ResidentConflict): ConflictException {
    const who = [
      fullName(conflict),
      `(${[conflict.apartments ?? 'sin apartamento', conflict.isActive ? null : 'inactivo'].filter(Boolean).join(', ')})`,
    ].join(' ');
    const message =
      field === 'email'
        ? `El correo ${value.trim()} ya lo tiene ${who}.`
        : `La cédula ${value.trim()} ya está registrada a ${who}.`;
    return new ConflictException({
      statusCode: 409,
      error: 'Conflict',
      code: field === 'email' ? 'EMAIL_IN_USE' : 'DOCUMENT_IN_USE',
      field,
      message,
      conflict,
    });
  }

  /**
   * Valida que el correo y la cédula no los tenga otro residente. Si el correo
   * lo tiene un residente inactivo y se pidió explícitamente, se le quita a él
   * (queda en su historial con el motivo) para poder usarlo aquí.
   */
  private async ensureAvailable(
    manager: EntityManager,
    values: { email?: string | null; document?: string | null },
    options: { excludeId?: string; takeEmailFromInactive?: boolean; newOwnerName: string },
  ): Promise<void> {
    if (values.document?.trim()) {
      const conflict = await this.findConflict(manager, 'document', values.document, options.excludeId);
      if (conflict) throw this.conflictError('document', values.document, conflict);
    }
    if (values.email?.trim()) {
      const conflict = await this.findConflict(manager, 'email', values.email, options.excludeId);
      if (!conflict) return;
      if (conflict.isActive || !options.takeEmailFromInactive) {
        throw this.conflictError('email', values.email, conflict);
      }
      const previousReason = getChangeContext()?.reason;
      setChangeReason(
        [`Correo pasado a ${options.newOwnerName} (estaba en ${fullName(conflict)}, inactivo)`, previousReason]
          .filter(Boolean)
          .join(' · '),
      );
      await trackedUpdate(manager.getRepository(Resident), conflict.id, { email: null as unknown as string });
    }
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
    await this.attachDeactivations([item]);
    return item;
  }

  /** Lets a resident replace their own profile photo from the app. */
  async updatePhoto(residentId: string, photoPath: string): Promise<Resident> {
    const resident = await this.repository.findOne({ where: { id: residentId } });
    if (!resident) throw new NotFoundException(`Resident #${residentId} not found`);
    await this.repository.update(residentId, { photoPath });
    return this.findOne(residentId);
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

  async getQrCode(
    residentId: string,
    apartmentId: string,
    callerId: string,
  ): Promise<{ dataUrl: string; residentId: string; apartmentId: string }> {
    if (residentId !== callerId) {
      const shared = await this.shareApartment(callerId, residentId);
      if (!shared) throw new ForbiddenException('You can only view the QR of members of your own apartment');
    }
    const resident = await this.findOne(residentId);
    const payload = JSON.stringify({ residentId: resident.id, apartmentId, type: 'resident-access' });
    const dataUrl = await QRCode.toDataURL(payload, {
      width: 400,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' },
    });
    return { dataUrl, residentId: resident.id, apartmentId };
  }

  /**
   * Every apartment a resident is linked to, via either the legacy
   * residents.apartment_id column or the resident_apartments junction.
   */
  private async getApartmentIds(residentId: string): Promise<string[]> {
    const resident = await this.repository.findOne({ where: { id: residentId } });
    const links = await this.residentApartmentsRepository.find({ where: { residentId } });
    const ids = new Set(links.map((l) => l.apartmentId));
    if (resident?.apartmentId) ids.add(resident.apartmentId);
    return [...ids];
  }

  private async shareApartment(residentAId: string, residentBId: string): Promise<boolean> {
    const [aIds, bIds] = await Promise.all([
      this.getApartmentIds(residentAId),
      this.getApartmentIds(residentBId),
    ]);
    return aIds.some((id) => bIds.includes(id));
  }

  /**
   * Lets a logged-in resident (the household head) register a family member
   * directly from their own session, without admin/porter privileges. The
   * new member is created inactive — an admin must activate them from the
   * web before their QR/signature becomes usable (see getQrCode/getFamilyMembers).
   */
  async createFamilyMember(
    headResidentId: string,
    dto: CreateFamilyMemberDto,
    photoPath?: string,
  ): Promise<{ resident: Resident; generatedPassword: string }> {
    const apartmentIds = await this.getApartmentIds(headResidentId);
    const apartmentId = apartmentIds[0];
    if (!apartmentId) {
      throw new BadRequestException('You must have an apartment assigned before adding family members');
    }

    // Lo llama el residente desde la app: no se revela quién tiene el dato.
    const existing = await this.repository.findOne({
      where: [{ document: dto.document }, ...(dto.email ? [{ email: dto.email }] : [])],
    });
    if (existing) throw new ConflictException('Email or document already in use');

    const familyType = await this.residentTypesRepository.findOne({ where: { code: 'family' } });
    if (!familyType) throw new BadRequestException('Family resident type is not configured');

    const generatedPassword = crypto.randomBytes(4).toString('hex');
    const passwordHash = await bcrypt.hash(generatedPassword, 10);

    const item = this.repository.create({
      name: dto.name,
      lastName: dto.lastName,
      document: dto.document,
      phone: dto.phone,
      email: dto.email,
      birthDate: dto.birthDate,
      photoPath,
      passwordHash,
      residentTypeId: familyType.id,
      apartmentId,
      isActive: false,
    });
    const saved = await this.repository.save(item);

    await this.residentApartmentsRepository.save(
      this.residentApartmentsRepository.create({ residentId: saved.id, apartmentId }),
    );

    const resident = await this.findOne(saved.id);
    return { resident, generatedPassword };
  }

  /**
   * Members of the caller's household (any apartment they're linked to),
   * excluding the caller themselves.
   */
  async getFamilyMembers(residentId: string): Promise<Resident[]> {
    const apartmentIds = await this.getApartmentIds(residentId);
    if (apartmentIds.length === 0) return [];

    const qb = this.repository
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.residentType', 'residentType')
      .where('r.id != :residentId', { residentId })
      .andWhere(
        '(r.apartment_id IN (:...apartmentIds) OR EXISTS (SELECT 1 FROM resident_apartments ra WHERE ra.resident_id = r.id AND ra.apartment_id IN (:...apartmentIds)))',
        { apartmentIds },
      )
      .orderBy('r.createdAt', 'DESC');

    const members = await qb.getMany();
    await this.attachPhotos(members);
    return members;
  }

  /**
   * Vehicles registered to any apartment the resident is linked to. A vehicle
   * belongs to the apartment, not to an individual resident, so owner/tenant/
   * family members of the same household all see the same list.
   */
  async getMyVehicles(residentId: string): Promise<ResidentVehicle[]> {
    const apartmentIds = await this.getApartmentIds(residentId);
    if (apartmentIds.length === 0) return [];
    return this.residentVehiclesRepository.find({
      where: { apartmentId: In(apartmentIds), isActive: true },
      relations: ['vehicleBrand'],
      order: { createdAt: 'DESC' },
    });
  }

  async create(dto: CreateResidentDto): Promise<Resident> {
    await this.ensureAvailable(this.repository.manager, dto, { newOwnerName: fullName(dto) });
    const passwordHash = await bcrypt.hash(dto.password, 10);
    const { password, ...rest } = dto;
    const item = this.repository.create({ ...rest, passwordHash });
    return this.repository.save(item);
  }

  async update(id: string, dto: UpdateResidentDto): Promise<Resident> {
    const { password, takeEmailFromInactive, ...rest } = dto;
    await this.repository.manager.transaction(async (manager) => {
      const repo = manager.getRepository(Resident);
      const item = await repo.findOne({ where: { id } });
      if (!item) throw new NotFoundException(`Resident #${id} not found`);
      // Solo se valida lo que cambia: no bloquear la edición por datos viejos.
      const emailChanged = rest.email !== undefined && rest.email?.trim().toLowerCase() !== item.email?.trim().toLowerCase();
      const documentChanged = rest.document !== undefined && rest.document?.trim() !== item.document?.trim();
      await this.ensureAvailable(
        manager,
        { email: emailChanged ? rest.email : null, document: documentChanged ? rest.document : null },
        { excludeId: id, takeEmailFromInactive, newOwnerName: fullName({ ...item, ...rest }) },
      );
      if (password) {
        (item as any).passwordHash = await bcrypt.hash(password, 10);
      }
      Object.assign(item, rest);
      await repo.save(item);
    });
    return this.findOne(id);
  }

  /**
   * Registra como residente a alguien que estaba como visitante (vino a ver un
   * apartamento y se mudó, o un familiar que ahora vive aquí). El visitante no
   * se borra: sus ingresos siguen en el historial. Si la cédula ya era de un
   * residente inactivo, se reactiva ese mismo registro en vez de duplicarlo.
   */
  async createFromVisitor(
    visitorId: string,
    dto: ResidentFromVisitorDto,
  ): Promise<{ resident: Resident; generatedPassword: string; emailSent: boolean; reactivated: boolean }> {
    const generatedPassword = generatePassword();
    const passwordHash = await bcrypt.hash(generatedPassword, 10);
    setChangeReason(`Registrado desde visitante: ${dto.reason.trim()}`);

    const { residentId, email, reactivated, apartmentLabel } = await this.repository.manager.transaction(async (manager) => {
      const repo = manager.getRepository(Resident);
      const visitor = await manager.findOne(Visitor, { where: { id: visitorId } });
      if (!visitor) throw new NotFoundException(`Visitor #${visitorId} not found`);

      const document = (dto.document ?? visitor.document)?.trim();
      if (!document) {
        throw new BadRequestException('El visitante no tiene cédula registrada; escríbala para registrarlo como residente');
      }
      const type = await manager.findOne(ResidentType, { where: { id: dto.residentTypeId } });
      if (!type) throw new BadRequestException('Tipo de residente no válido');
      const [apartment]: { label: string }[] = await manager.query(
        `SELECT CONCAT_WS(' · ', t.name, 'Apt. ' || a.number) AS label
           FROM apartments a LEFT JOIN towers t ON t.id = a.tower_id WHERE a.id = $1`,
        [dto.apartmentId],
      );
      if (!apartment) throw new BadRequestException('Apartamento no válido');

      const existing = await repo.findOne({ where: { document } });
      if (existing?.isActive) {
        const conflict = await this.findConflict(manager, 'document', document);
        throw this.conflictError('document', document, conflict!);
      }
      const name = existing ? fullName(existing) : fullName(visitor);
      const email = dto.email?.trim() || null;
      await this.ensureAvailable(
        manager,
        { email },
        { excludeId: existing?.id, takeEmailFromInactive: dto.takeEmailFromInactive, newOwnerName: name },
      );
      const phone = dto.phone?.trim() || visitor.phone?.trim() || null;

      let id: string;
      if (existing) {
        id = existing.id;
        await trackedUpdate(repo, id, {
          isActive: true,
          residentTypeId: type.id,
          passwordHash,
          ...(phone ? { phone } : {}),
          ...(email ? { email } : {}),
          ...(!existing.photoPath && visitor.photoPath ? { photoPath: visitor.photoPath } : {}),
        });
      } else {
        const saved = await repo.save(
          repo.create({
            name: visitor.name.trim(),
            lastName: visitor.lastName.trim(),
            document,
            phone: phone ?? undefined,
            email: email ?? undefined,
            photoPath: visitor.photoPath ?? undefined,
            passwordHash,
            residentTypeId: type.id,
            isActive: true,
          }),
        );
        id = saved.id;
      }

      await trackedUpdate(repo, id, { apartmentId: dto.apartmentId });
      const links = manager.getRepository(ResidentApartment);
      if (!(await links.findOne({ where: { residentId: id, apartmentId: dto.apartmentId } }))) {
        await links.save(links.create({ residentId: id, apartmentId: dto.apartmentId }));
      }

      await recordCustomChange(manager, {
        entityType: 'visitor',
        entityId: visitor.id,
        entityLabel: fullName(visitor),
        changes: [
          { field: 'residentId', label: 'Registrado como residente', from: null, to: `${name} · ${apartment.label}`, kind: 'text' },
        ],
      });
      return { residentId: id, email: email ?? existing?.email ?? null, reactivated: Boolean(existing), apartmentLabel: apartment.label };
    });

    const resident = await this.findOne(residentId);
    const emailSent = email
      ? await this.mailService.sendResidentCredentials(email, {
          name: fullName(resident),
          loginEmail: email,
          password: generatedPassword,
          apartmentLabel,
        })
      : false;
    return { resident, generatedPassword, emailSent, reactivated };
  }

  /**
   * Pasa un residente a visitante (p. ej. un familiar que en realidad no vive
   * aquí): se inhabilita como residente, sin borrar nada, y queda un visitante
   * con sus datos para que portería lo registre en cada ingreso. Si ya existía
   * un visitante con esa cédula se reutiliza.
   */
  async convertToVisitor(id: string, reason: string): Promise<{ resident: Resident; visitor: Visitor }> {
    setChangeReason(`Pasado a visitante: ${reason.trim()}`);
    const visitorId = await this.repository.manager.transaction(async (manager) => {
      const repo = manager.getRepository(Resident);
      const resident = await repo.findOne({ where: { id } });
      if (!resident) throw new NotFoundException(`Resident #${id} not found`);

      const visitors = manager.getRepository(Visitor);
      let visitor = await visitors.findOne({ where: { document: resident.document.trim() } });
      if (!visitor) {
        visitor = await visitors.save(
          visitors.create({
            name: resident.name.trim(),
            lastName: resident.lastName.trim(),
            document: resident.document.trim(),
            phone: resident.phone,
            photoPath: resident.photoPath ?? null,
            photoUpdatedAt: resident.photoPath ? new Date() : null,
          }),
        );
      }
      if (resident.isActive) {
        await trackedUpdate(repo, id, { isActive: false });
      }
      await recordCustomChange(manager, {
        entityType: 'resident',
        entityId: id,
        entityLabel: fullName(resident),
        changes: [
          { field: 'visitorId', label: 'Registrado como visitante', from: null, to: `${fullName(visitor)} · CC ${visitor.document}`, kind: 'text' },
        ],
      });
      return visitor.id;
    });
    const visitor = await this.repository.manager.findOneOrFail(Visitor, { where: { id: visitorId } });
    return { resident: await this.findOne(id), visitor };
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
    await trackedUpdate(this.repository, id, { isActive: false });
  }

  async deactivate(id: string, reason?: string): Promise<Resident> {
    await this.findOne(id);
    setChangeReason(reason);
    await trackedUpdate(this.repository, id, { isActive: false });
    return this.findOne(id);
  }

  /** Vuelve a habilitar un residente (p. ej. si se inhabilitó por error). */
  async activate(id: string, reason?: string): Promise<Resident> {
    await this.findOne(id);
    setChangeReason(reason);
    await trackedUpdate(this.repository, id, { isActive: true });
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
