/**
 * Historial de cambios contra PostgreSQL real: subscriber + trackedUpdate +
 * contexto de la petición.
 *
 *   CHANGE_HISTORY_PG_URL=postgres://postgres:postgres@localhost:55433/change_history npx jest change-history.postgres
 */
import { DataSource } from 'typeorm';
import { globSync } from 'glob';
import { SnakeCaseNamingStrategy } from '../common/strategies/snake-case.naming-strategy';
import { ResidentVehiclesService } from '../resident-vehicles/resident-vehicles.service';
import { ResidentVehicle } from '../resident-vehicles/entities/resident-vehicle.entity';
import { Tower } from '../towers/entities/tower.entity';
import { Apartment } from '../apartments/entities/apartment.entity';
import { VehicleBrand } from '../vehicle-brands/entities/vehicle-brand.entity';
import { EmployeeRole } from '../employee-roles/entities/employee-role.entity';
import { Employee } from '../employees/entities/employee.entity';
import { Visitor } from '../visitors/entities/visitor.entity';
import { ResidentType } from '../resident-types/entities/resident-type.entity';
import { Resident } from '../residents/entities/resident.entity';
import { ResidentApartment } from '../resident-apartments/entities/resident-apartment.entity';
import { ChangeLog } from './entities/change-log.entity';
import { ChangeHistorySubscriber } from './change-history.subscriber';
import { ChangeHistoryService } from './change-history.service';
import { runWithChangeContext } from './change-context';
import { EntityClass, trackedUpdate } from './change-recorder';

const PG_URL = process.env.CHANGE_HISTORY_PG_URL;
const describePg = PG_URL ? describe : describe.skip;

// Todas las entidades del proyecto, para que TypeORM resuelva cualquier relación.
const ENTITIES = globSync(`${__dirname}/../**/*.entity.ts`)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  .flatMap((file) => Object.values(require(file) as Record<string, unknown>))
  .filter((value): value is EntityClass => typeof value === 'function');

describePg('Change history (PostgreSQL)', () => {
  let source: DataSource;
  let porter: Employee;
  let apt101: Apartment;
  let apt202: Apartment;
  let brand: VehicleBrand;
  let residentType: ResidentType;
  let vehicles: ResidentVehiclesService;

  const asPorter = <T>(fn: () => Promise<T>) =>
    runWithChangeContext({ actorType: 'employee', actorId: porter.id }, fn);
  const logsFor = (entityType: string, entityId: string) =>
    source
      .getRepository(ChangeLog)
      .find({ where: { entityType, entityId }, order: { createdAt: 'ASC' } });

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
    new ChangeHistorySubscriber(source);

    const role = await source
      .getRepository(EmployeeRole)
      .save({ code: 'porter', name: 'Portero' });
    porter = await source.getRepository(Employee).save({
      name: 'Porteria',
      lastName: 'Fase 1',
      username: 'porteria1',
      passwordHash: 'x',
      roleId: role.id,
    });
    const tower = await source.getRepository(Tower).save({
      code: '4',
      name: 'Torre 4',
      totalFloors: 5,
      apartmentsPerFloor: 4,
    });
    apt101 = await source
      .getRepository(Apartment)
      .save({ number: '101', towerId: tower.id });
    apt202 = await source
      .getRepository(Apartment)
      .save({ number: '202', towerId: tower.id });
    brand = await source.getRepository(VehicleBrand).save({ name: 'Mazda' });
    residentType = await source
      .getRepository(ResidentType)
      .save({ code: 'owner', name: 'Propietario' });
    vehicles = new ResidentVehiclesService(
      source.getRepository(ResidentVehicle),
    );
  }, 60_000);

  afterAll(async () => {
    await source?.destroy();
  });

  it('records create, edit, reassignment (with reason) and delete of a vehicle', async () => {
    const created = await asPorter(() =>
      vehicles.create(
        {
          apartmentId: apt101.id,
          vehicleBrandId: brand.id,
          vehicleType: 'car',
          plate: 'abc123',
        },
        porter.id,
      ),
    );
    await asPorter(() =>
      vehicles.update(created.id, { plate: 'ABC124', color: 'Rojo' }),
    );
    await asPorter(() =>
      vehicles.reassign(
        created.id,
        apt202.id,
        'Se registró en el apartamento equivocado',
      ),
    );
    await asPorter(() => vehicles.remove(created.id));

    const logs = await logsFor('resident_vehicle', created.id);
    expect(logs.map((log) => log.action)).toEqual([
      'created',
      'updated',
      'updated',
      'deleted',
    ]);
    expect(
      logs.every(
        (log) =>
          log.actorName === 'Porteria Fase 1' && log.actorType === 'employee',
      ),
    ).toBe(true);

    const [create, edit, reassign] = logs;
    expect(create.entityLabel).toBe('ABC 123');
    expect(create.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'Apartamento',
          from: null,
          to: 'Torre 4 · Apt. 101',
        }),
        expect.objectContaining({ label: 'Marca', to: 'Mazda' }),
        expect.objectContaining({ label: 'Tipo', to: 'Carro' }),
      ]),
    );
    expect(edit.changes).toEqual([
      expect.objectContaining({
        label: 'Placa',
        from: 'ABC 123',
        to: 'ABC 124',
      }),
      expect.objectContaining({ label: 'Color', from: null, to: 'Rojo' }),
    ]);
    expect(reassign.changes).toEqual([
      expect.objectContaining({
        label: 'Apartamento',
        from: 'Torre 4 · Apt. 101',
        to: 'Torre 4 · Apt. 202',
      }),
    ]);
    expect(reassign.reason).toBe('Se registró en el apartamento equivocado');
  });

  it('does not log an edit that changes nothing', async () => {
    const created = await asPorter(() =>
      vehicles.create(
        {
          apartmentId: apt101.id,
          vehicleBrandId: brand.id,
          vehicleType: 'car',
          plate: 'XYZ999',
        },
        porter.id,
      ),
    );
    await asPorter(() => vehicles.update(created.id, { plate: 'XYZ 999' }));
    expect(
      (await logsFor('resident_vehicle', created.id)).map((log) => log.action),
    ).toEqual(['created']);
  });

  it('records visitor edits made with save()', async () => {
    const repo = source.getRepository(Visitor);
    const visitor = await asPorter(() =>
      repo.save(repo.create({ name: 'ANA  DELIA', lastName: 'CAEDENAS' })),
    );
    await asPorter(() => repo.save({ ...visitor, lastName: 'CÁRDENAS' }));

    const logs = await logsFor('visitor', visitor.id);
    expect(logs[1].changes).toEqual([
      expect.objectContaining({
        label: 'Apellido',
        from: 'CAEDENAS',
        to: 'CÁRDENAS',
      }),
    ]);
    expect(logs[1].entityLabel).toBe('ANA DELIA CÁRDENAS');
  });

  it('records resident status changes and apartment assignments', async () => {
    const residents = source.getRepository(Resident);
    const resident = await residents.save({
      name: 'Oliver',
      lastName: 'Solano',
      document: '1001',
      passwordHash: 'x',
      residentTypeId: residentType.id,
    });
    await asPorter(() =>
      trackedUpdate(residents, resident.id, { isActive: false }),
    );
    const link = await asPorter(() =>
      source
        .getRepository(ResidentApartment)
        .save({ residentId: resident.id, apartmentId: apt202.id }),
    );
    await asPorter(() => source.getRepository(ResidentApartment).remove(link));

    const logs = await logsFor('resident', resident.id);
    expect(logs[0]).toEqual(
      expect.objectContaining({
        action: 'created',
        actorType: 'system',
        actorName: null,
      }),
    );
    expect(logs.slice(1).map((log) => log.changes[0])).toEqual([
      expect.objectContaining({
        label: 'Estado',
        from: 'Activo',
        to: 'Inactivo',
      }),
      expect.objectContaining({
        label: 'Apartamento asignado',
        from: null,
        to: 'Torre 4 · Apt. 202',
      }),
      expect.objectContaining({
        label: 'Apartamento asignado',
        from: 'Torre 4 · Apt. 202',
        to: null,
      }),
    ]);
  });

  it('lists and searches the history by plate or by previous values', async () => {
    const history = new ChangeHistoryService(source.getRepository(ChangeLog));
    const byPlate = await history.findAll({
      entityType: 'resident_vehicle',
      search: 'abc 124',
    });
    expect(byPlate.data.length).toBeGreaterThan(0);
    const byApartment = await history.findAll({
      entityType: 'resident_vehicle',
      search: 'apt. 202',
    });
    expect(
      byApartment.data.some((log) => log.reason?.includes('equivocado')),
    ).toBe(true);
  });
});
