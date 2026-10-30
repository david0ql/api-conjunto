/**
 * Residentes contra PostgreSQL real: conflictos de correo/cédula con mensaje
 * claro, pasar el correo de un inactivo, volver a habilitar y conversión
 * visitante ⇄ residente, todo con historial.
 *
 *   CHANGE_HISTORY_PG_URL=postgres://postgres:postgres@localhost:55433/change_history npx jest residents.postgres
 */
import { ConflictException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { globSync } from 'glob';
import { SnakeCaseNamingStrategy } from '../common/strategies/snake-case.naming-strategy';
import { Tower } from '../towers/entities/tower.entity';
import { Apartment } from '../apartments/entities/apartment.entity';
import { EmployeeRole } from '../employee-roles/entities/employee-role.entity';
import { Employee } from '../employees/entities/employee.entity';
import { Visitor } from '../visitors/entities/visitor.entity';
import { ResidentType } from '../resident-types/entities/resident-type.entity';
import { ResidentApartment } from '../resident-apartments/entities/resident-apartment.entity';
import { ResidentVehicle } from '../resident-vehicles/entities/resident-vehicle.entity';
import { ChangeLog } from '../change-history/entities/change-log.entity';
import { ChangeHistorySubscriber } from '../change-history/change-history.subscriber';
import { runWithChangeContext } from '../change-history/change-context';
import { EntityClass } from '../change-history/change-recorder';
import { MailService } from '../mail/mail.service';
import { VehicleBrand } from '../vehicle-brands/entities/vehicle-brand.entity';
import { ResidentVehiclesService } from '../resident-vehicles/resident-vehicles.service';
import { AccessAuditService } from '../access-audit/access-audit.service';
import { AccessAudit } from '../access-audit/entities/access-audit.entity';
import { ResidentPushService } from '../resident-push/resident-push.service';
import { Resident } from './entities/resident.entity';
import { ResidentsService } from './residents.service';

const PG_URL = process.env.CHANGE_HISTORY_PG_URL;
const describePg = PG_URL ? describe : describe.skip;

const ENTITIES = globSync(`${__dirname}/../**/*.entity.ts`)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  .flatMap((file) => Object.values(require(file) as Record<string, unknown>))
  .filter((value): value is EntityClass => typeof value === 'function');

describePg('Residents (PostgreSQL)', () => {
  let source: DataSource;
  let admin: Employee;
  let apt569: Apartment;
  let owner: ResidentType;
  let service: ResidentsService;
  const mail = { sendResidentCredentials: jest.fn().mockResolvedValue(true) };

  const asAdmin = <T>(fn: () => Promise<T>) =>
    runWithChangeContext({ actorType: 'employee', actorId: admin.id }, fn);
  /** Cambios posteriores a crear el registro (el alta de los datos de prueba también queda en el historial). */
  const logsFor = (entityType: string, entityId: string) =>
    source
      .getRepository(ChangeLog)
      .find({ where: { entityType, entityId, action: 'updated' }, order: { createdAt: 'ASC' } });
  const makeResident = (data: Partial<Resident>) =>
    source.getRepository(Resident).save({
      lastName: 'Prueba',
      passwordHash: 'x',
      residentTypeId: owner.id,
      apartmentId: apt569.id,
      ...data,
    } as Resident);
  const conflictOf = async (promise: Promise<unknown>) => {
    const error = await promise.then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictException);
    return (error as ConflictException).getResponse() as Record<string, any>;
  };

  beforeAll(async () => {
    source = new DataSource({
      type: 'postgres',
      url: PG_URL,
      entities: ENTITIES,
      synchronize: true,
      dropSchema: true,
      namingStrategy: new SnakeCaseNamingStrategy(),
      logging: false,
    });
    await source.initialize();
    await source.query('CREATE EXTENSION IF NOT EXISTS unaccent');
    new ChangeHistorySubscriber(source);

    const role = await source.getRepository(EmployeeRole).save({ code: 'admin', name: 'Administrador' });
    admin = await source.getRepository(Employee).save({
      name: 'Aura',
      lastName: 'Admin',
      username: 'aura',
      passwordHash: 'x',
      roleId: role.id,
    });
    const tower = await source.getRepository(Tower).save({ code: '9', name: 'Torre 9', totalFloors: 9, apartmentsPerFloor: 8 });
    apt569 = await source.getRepository(Apartment).save({ number: '569', towerId: tower.id });
    owner = await source.getRepository(ResidentType).save({ code: 'owner', name: 'Propietario' });
    service = new ResidentsService(
      source.getRepository(Resident),
      source.getRepository(ResidentApartment),
      source.getRepository(ResidentType),
      source.getRepository(ResidentVehicle),
      mail as unknown as MailService,
    );
  }, 60_000);

  afterAll(async () => {
    await source?.destroy();
  });

  it('says who already has the email instead of a generic error', async () => {
    const nestor = await makeResident({ name: 'Nestor', document: '91157182', email: 'ediper281@hotmail.com', isActive: false });
    const johana = await makeResident({ name: 'Johana', document: '37620043' });

    const response = await conflictOf(asAdmin(() => service.update(johana.id, { email: 'EDIPER281@hotmail.com ' })));
    expect(response.code).toBe('EMAIL_IN_USE');
    expect(response.message).toBe('El correo EDIPER281@hotmail.com ya lo tiene Nestor Prueba (Torre 9 · Apt. 569, inactivo).');
    expect(response.conflict).toMatchObject({ id: nestor.id, isActive: false });

    // Nada cambió por el intento fallido.
    expect((await source.getRepository(Resident).findOneByOrFail({ id: johana.id })).email).toBeNull();
  });

  it('takes the email from an inactive resident, leaving it in both histories', async () => {
    const nestor = await makeResident({ name: 'Viejo', document: '1001', email: 'compartido@x.com', isActive: false });
    const johana = await makeResident({ name: 'Nueva', document: '1002' });

    await asAdmin(() => service.update(johana.id, { email: 'compartido@x.com', takeEmailFromInactive: true }));

    const repo = source.getRepository(Resident);
    expect((await repo.findOneByOrFail({ id: johana.id })).email).toBe('compartido@x.com');
    expect((await repo.findOneByOrFail({ id: nestor.id })).email).toBeNull();

    const [fromLog] = await logsFor('resident', nestor.id);
    expect(fromLog.changes).toEqual([expect.objectContaining({ field: 'email', from: 'compartido@x.com', to: null })]);
    expect(fromLog.reason).toBe('Correo pasado a Nueva Prueba (estaba en Viejo Prueba, inactivo)');
    expect(fromLog.actorName).toBe('Aura Admin');
    const [toLog] = await logsFor('resident', johana.id);
    expect(toLog.changes).toEqual([expect.objectContaining({ field: 'email', from: null, to: 'compartido@x.com' })]);
  });

  it('never takes the email from an active resident', async () => {
    await makeResident({ name: 'Marlon', document: '2001', email: 'activo@x.com' });
    const yamile = await makeResident({ name: 'Yamile', document: '2002' });
    const response = await conflictOf(
      asAdmin(() => service.update(yamile.id, { email: 'activo@x.com', takeEmailFromInactive: true })),
    );
    expect(response.message).toBe('El correo activo@x.com ya lo tiene Marlon Prueba (Torre 9 · Apt. 569).');
  });

  it('names the resident that already has the document', async () => {
    await makeResident({ name: 'James', document: '37580193', isActive: false });
    const response = await conflictOf(
      asAdmin(() =>
        service.create({ name: 'Ingrid', lastName: 'Miranda', document: '37580193', password: 'secreto', residentTypeId: owner.id }),
      ),
    );
    expect(response.code).toBe('DOCUMENT_IN_USE');
    expect(response.message).toBe('La cédula 37580193 ya está registrada a James Prueba (Torre 9 · Apt. 569, inactivo).');
  });

  it('re-enables a resident with reason and shows who deactivated it', async () => {
    const resident = await makeResident({ name: 'Error', document: '3001' });
    await asAdmin(() => service.deactivate(resident.id, 'Se equivocó de persona'));

    const inactive = (await service.findOne(resident.id)) as Resident & { deactivation: any };
    expect(inactive.deactivation).toMatchObject({ by: 'Aura Admin', reason: 'Se equivocó de persona' });

    // Buscar por texto sin filtro de estado también encuentra inactivos.
    const found = await service.findAll(undefined, { search: '3001' });
    expect(found.data.map((r) => r.id)).toContain(resident.id);

    await asAdmin(() => service.activate(resident.id, 'Inhabilitado por error'));
    const logs = await logsFor('resident', resident.id);
    expect(logs.map((l) => [l.changes[0].to, l.reason])).toEqual([
      ['Inactivo', 'Se equivocó de persona'],
      ['Activo', 'Inhabilitado por error'],
    ]);
  });

  it('registers a visitor as resident without losing the visitor', async () => {
    const visitor = await source.getRepository(Visitor).save({ name: 'Ana', lastName: 'Visita', document: '4001', phone: '300' });

    const result = await asAdmin(() =>
      service.createFromVisitor(visitor.id, {
        residentTypeId: owner.id,
        apartmentId: apt569.id,
        email: 'ana@x.com',
        reason: 'Compró el 569',
      }),
    );
    expect(result.reactivated).toBe(false);
    expect(result.generatedPassword).toHaveLength(8);
    expect(result.resident).toMatchObject({ name: 'Ana', document: '4001', phone: '300', email: 'ana@x.com', isActive: true });
    expect(mail.sendResidentCredentials).toHaveBeenCalledWith('ana@x.com', expect.objectContaining({ apartmentLabel: 'Torre 9 · Apt. 569' }));

    expect(await source.getRepository(Visitor).findOneBy({ id: visitor.id })).not.toBeNull();
    const [visitorLog] = await logsFor('visitor', visitor.id);
    expect(visitorLog.changes[0]).toMatchObject({ label: 'Registrado como residente', to: 'Ana Visita · Torre 9 · Apt. 569' });
    expect(visitorLog.reason).toBe('Registrado desde visitante: Compró el 569');
    expect(visitorLog.actorName).toBe('Aura Admin');
    const residentLogs = await source.getRepository(ChangeLog).findBy({ entityType: 'resident', entityId: result.resident.id });
    expect(residentLogs.map((l) => l.action)).toContain('created');
    expect(residentLogs.every((l) => l.reason === 'Registrado desde visitante: Compró el 569')).toBe(true);
  });

  it('turns a resident into a visitor and back, reusing the same records', async () => {
    const resident = await makeResident({ name: 'Primo', document: '5001', phone: '311' });

    const { visitor } = await asAdmin(() => service.convertToVisitor(resident.id, 'Solo viene de visita'));
    expect(visitor).toMatchObject({ name: 'Primo', document: '5001', phone: '311' });
    expect((await source.getRepository(Resident).findOneByOrFail({ id: resident.id })).isActive).toBe(false);

    const result = await asAdmin(() =>
      service.createFromVisitor(visitor.id, { residentTypeId: owner.id, apartmentId: apt569.id, reason: 'Se mudó' }),
    );
    expect(result.reactivated).toBe(true);
    expect(result.resident.id).toBe(resident.id);
    expect(result.resident.isActive).toBe(true);
    expect(await source.getRepository(Visitor).countBy({ document: '5001' })).toBe(1);

    const labels = (await logsFor('resident', resident.id)).flatMap((l) => l.changes.map((c) => `${c.label}: ${c.to}`));
    expect(labels).toEqual(
      expect.arrayContaining(['Estado: Inactivo', 'Registrado como visitante: Primo Prueba · CC 5001', 'Estado: Activo']),
    );
  });

  it('refuses to register a visitor whose document is an active resident', async () => {
    await makeResident({ name: 'Ya', document: '6001' });
    const visitor = await source.getRepository(Visitor).save({ name: 'Ya', lastName: 'Visita', document: '6001' });
    const response = await conflictOf(
      asAdmin(() => service.createFromVisitor(visitor.id, { residentTypeId: owner.id, apartmentId: apt569.id, reason: 'x' })),
    );
    expect(response.message).toBe('La cédula 6001 ya está registrada a Ya Prueba (Torre 9 · Apt. 569).');
  });

  it('moves a resident plate to visitor without deleting it (KJR 809)', async () => {
    const brand = await source.getRepository(VehicleBrand).save({ name: 'Chevrolet' });
    const vehicles = new ResidentVehiclesService(source.getRepository(ResidentVehicle));
    const porteria = new AccessAuditService(
      source.getRepository(AccessAudit),
      source.getRepository(ResidentVehicle),
      source.getRepository(Visitor),
      {} as ResidentPushService,
    );
    const truck = await asAdmin(() =>
      vehicles.create({ apartmentId: apt569.id, vehicleBrandId: brand.id, vehicleType: 'truck', plate: 'kjr809' }, admin.id),
    );
    expect((await porteria.searchByPlate('KJR809')).kind).toBe('resident_vehicle');

    await asAdmin(() => vehicles.convertToVisitor(truck.id, 'Es visitante, no vive en el apartamento'));

    // Portería ya no lo reconoce como del apartamento; el registro sigue ahí.
    expect((await porteria.searchByPlate('KJR 809')).kind).toBe('not_found');
    expect((await vehicles.findByApartment(apt569.id)).map((v) => v.id)).not.toContain(truck.id);
    expect((await vehicles.findOne(truck.id)).isActive).toBe(false);
    // Tampoco sale en la lista de vehículos, salvo que se busque la placa.
    expect((await vehicles.findAll({})).data.map((v) => v.id)).not.toContain(truck.id);
    expect((await vehicles.findAll({ search: 'KJR' })).data.map((v) => v.id)).toContain(truck.id);
    // Registrarla de nuevo como residente explica qué pasa en vez de un error genérico.
    await expect(
      vehicles.create({ apartmentId: apt569.id, vehicleBrandId: brand.id, vehicleType: 'car', plate: 'KJR 809' }, admin.id),
    ).rejects.toThrow('La placa KJR 809 está inhabilitada (antes de Torre 9 · Apt. 569)');

    await asAdmin(() => vehicles.reactivate(truck.id, 'Se pasó por error'));
    expect((await porteria.searchByPlate('KJR809')).kind).toBe('resident_vehicle');

    const logs = await logsFor('resident_vehicle', truck.id);
    expect(logs.map((l) => [l.changes[0].to, l.reason, l.actorName])).toEqual([
      ['Inhabilitado', 'Es visitante, no vive en el apartamento', 'Aura Admin'],
      ['Habilitado', 'Se pasó por error', 'Aura Admin'],
    ]);
  });
});
