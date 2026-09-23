import {
  EntityManager,
  FindOptionsWhere,
  ObjectLiteral,
  Repository,
} from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { Logger } from '@nestjs/common';
import { ResidentVehicle } from '../resident-vehicles/entities/resident-vehicle.entity';
import { Visitor } from '../visitors/entities/visitor.entity';
import { Package } from '../packages/entities/package.entity';
import { Resident } from '../residents/entities/resident.entity';
import { ResidentApartment } from '../resident-apartments/entities/resident-apartment.entity';
import {
  ChangeAction,
  ChangeLog,
  ChangeLogField,
} from './entities/change-log.entity';
import { getChangeContext } from './change-context';

type Row = Record<string, unknown>;
/** Clase de entidad TypeORM (lo que llega como event.metadata.target). */
export type EntityClass = abstract new (...args: never[]) => object;
type Formatter = (
  value: unknown,
  manager: EntityManager,
) => Promise<string | null> | string | null;

interface TrackedField {
  label: string;
  kind?: ChangeLogField['kind'];
  format?: Formatter;
}

interface TrackedEntity {
  type: string;
  fields: Record<string, TrackedField>;
  label: (row: Row, manager: EntityManager) => Promise<string | null>;
}

const logger = new Logger('ChangeHistory');

// ─── Formateadores: ids → texto legible al momento del cambio ────────────────

async function lookup(
  manager: EntityManager,
  sql: string,
  id: unknown,
): Promise<string | null> {
  if (!id) return null;
  const rows: Array<{ label: string | null }> = await manager.query(sql, [id]);
  return rows[0]?.label ?? null;
}

const apartmentLabel: Formatter = (id, manager) =>
  lookup(
    manager,
    `SELECT CONCAT_WS(' · ', t.name, 'Apt. ' || a.number) AS label
       FROM apartments a LEFT JOIN towers t ON t.id = a.tower_id WHERE a.id = $1`,
    id,
  );
const residentLabel: Formatter = (id, manager) =>
  lookup(
    manager,
    `SELECT CONCAT_WS(' ', name, last_name) AS label FROM residents WHERE id = $1`,
    id,
  );
const employeeLabel: Formatter = (id, manager) =>
  lookup(
    manager,
    `SELECT CONCAT_WS(' ', name, last_name) AS label FROM employees WHERE id = $1`,
    id,
  );
const brandLabel: Formatter = (id, manager) =>
  lookup(manager, `SELECT name AS label FROM vehicle_brands WHERE id = $1`, id);
const residentTypeLabel: Formatter = (id, manager) =>
  lookup(manager, `SELECT name AS label FROM resident_types WHERE id = $1`, id);

const VEHICLE_TYPES: Record<string, string> = {
  car: 'Carro',
  motorcycle: 'Moto',
  truck: 'Camión',
  bicycle: 'Bicicleta',
  other: 'Otro',
};
const vehicleTypeLabel: Formatter = (value) => {
  const type = raw(value);
  return type ? (VEHICLE_TYPES[type] ?? type) : null;
};
const yesNo =
  (yes: string, no: string): Formatter =>
  (value) =>
    value == null ? null : value ? yes : no;

const fullName = (row: Row) =>
  Promise.resolve(
    [row.name, row.lastName]
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim() || null,
  );

// ─── Qué se registra de cada entidad ─────────────────────────────────────────

const TRACKED = new Map<EntityClass, TrackedEntity>([
  [
    ResidentVehicle,
    {
      type: 'resident_vehicle',
      label: (row) => Promise.resolve((row.plate as string) ?? null),
      fields: {
        apartmentId: { label: 'Apartamento', format: apartmentLabel },
        plate: { label: 'Placa' },
        vehicleType: { label: 'Tipo', format: vehicleTypeLabel },
        vehicleBrandId: { label: 'Marca', format: brandLabel },
        model: { label: 'Modelo' },
        color: { label: 'Color' },
        notes: { label: 'Notas' },
      },
    },
  ],
  [
    Visitor,
    {
      type: 'visitor',
      label: fullName,
      fields: {
        name: { label: 'Nombre' },
        lastName: { label: 'Apellido' },
        document: { label: 'Documento' },
        phone: { label: 'Teléfono' },
        photoPath: { label: 'Foto', kind: 'photo' },
      },
    },
  ],
  [
    Package,
    {
      type: 'package',
      label: async (row, manager) => {
        const apartment = await apartmentLabel(row.apartmentId, manager);
        return ['Paquete', apartment].filter(Boolean).join(' · ');
      },
      fields: {
        apartmentId: { label: 'Apartamento', format: apartmentLabel },
        residentId: { label: 'Residente', format: residentLabel },
        description: { label: 'Descripción' },
        delivered: { label: 'Estado', format: yesNo('Entregado', 'Pendiente') },
        deliveredTime: { label: 'Hora de entrega', kind: 'date' },
        receivedByResidentId: { label: 'Recibió', format: residentLabel },
        deliveredByEmployeeId: { label: 'Entregó', format: employeeLabel },
        deliveryPhotoPath: { label: 'Foto de entrega', kind: 'photo' },
      },
    },
  ],
  [
    Resident,
    {
      type: 'resident',
      label: fullName,
      fields: {
        name: { label: 'Nombre' },
        lastName: { label: 'Apellido' },
        document: { label: 'Documento' },
        phone: { label: 'Teléfono' },
        email: { label: 'Correo' },
        birthDate: { label: 'Fecha de nacimiento' },
        residentTypeId: {
          label: 'Tipo de residente',
          format: residentTypeLabel,
        },
        apartmentId: { label: 'Apartamento principal', format: apartmentLabel },
        isActive: { label: 'Estado', format: yesNo('Activo', 'Inactivo') },
        photoPath: { label: 'Foto', kind: 'photo' },
      },
    },
  ],
]);

export function isTrackedEntity(target: unknown): target is EntityClass {
  return (
    typeof target === 'function' &&
    (TRACKED.has(target as EntityClass) || target === ResidentApartment)
  );
}

// ─── Cálculo del cambio ──────────────────────────────────────────────────────

/** Valor crudo comparable: fechas a ISO, vacíos a null. */
function raw(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value as string | number | boolean);
}

async function display(
  field: TrackedField,
  value: unknown,
  manager: EntityManager,
): Promise<string | null> {
  if (raw(value) === null) return null;
  // Fotos: se guarda la ruta para que la web pueda mostrar la de antes y la de después.
  if (field.kind === 'photo') return raw(value);
  if (field.format) return (await field.format(value, manager)) ?? raw(value);
  return raw(value);
}

async function diff(
  config: TrackedEntity,
  before: Row | null,
  after: Row | null,
  manager: EntityManager,
): Promise<ChangeLogField[]> {
  const changes: ChangeLogField[] = [];
  for (const [key, field] of Object.entries(config.fields)) {
    // En una actualización, una propiedad ausente del objeto guardado significa
    // "no se tocó", no "se borró".
    if (before && after && after[key] === undefined) continue;
    const from = before ? raw(before[key]) : null;
    const to = after ? raw(after[key]) : null;
    if (from === to) continue;
    changes.push({
      field: key,
      label: field.label,
      from: before ? await display(field, before[key], manager) : null,
      to: after ? await display(field, after[key], manager) : null,
      kind: field.kind ?? 'text',
    });
  }
  return changes;
}

async function resolveActorName(
  manager: EntityManager,
): Promise<string | null> {
  const context = getChangeContext();
  if (!context?.actorId) return null;
  if (context.actorName === undefined) {
    context.actorName =
      context.actorType === 'employee'
        ? await employeeLabel(context.actorId, manager)
        : await residentLabel(context.actorId, manager);
  }
  return context.actorName ?? null;
}

async function save(
  manager: EntityManager,
  entry: Pick<
    ChangeLog,
    'entityType' | 'entityId' | 'entityLabel' | 'action' | 'changes'
  >,
): Promise<void> {
  const context = getChangeContext();
  await manager.insert(ChangeLog, {
    ...entry,
    reason: context?.reason ?? null,
    actorType: context?.actorType ?? 'system',
    actorId: context?.actorId ?? null,
    actorName: await resolveActorName(manager),
  });
}

/**
 * Registra en el historial un alta, edición o borrado de una entidad
 * rastreada. Nunca lanza: un fallo del historial no debe tumbar la operación.
 */
export async function recordEntityChange(
  manager: EntityManager,
  target: EntityClass,
  action: ChangeAction,
  before: Row | null,
  after: Row | null,
): Promise<void> {
  try {
    if (target === ResidentApartment) {
      await recordResidentApartmentChange(manager, before, after);
      return;
    }
    const config = TRACKED.get(target);
    if (!config) return;

    const current = after ?? before;
    const entityId =
      (current?.id as string | undefined) ?? (before?.id as string | undefined);
    if (!entityId) return;

    const changes = await diff(
      config,
      action === 'created' ? null : before,
      action === 'deleted' ? null : after,
      manager,
    );
    if (action === 'updated' && changes.length === 0) return;

    await save(manager, {
      entityType: config.type,
      entityId,
      entityLabel: current
        ? await config.label({ ...before, ...after }, manager)
        : null,
      action,
      changes,
    });
  } catch (error) {
    logger.warn(
      `No fue posible registrar el cambio: ${(error as Error).message}`,
    );
  }
}

/** Asignar o quitar un apartamento (tabla resident_apartments) queda en el historial del residente. */
async function recordResidentApartmentChange(
  manager: EntityManager,
  before: Row | null,
  after: Row | null,
): Promise<void> {
  const residentId = (after?.residentId ?? before?.residentId) as
    | string
    | undefined;
  const fromApartment = before?.apartmentId ?? null;
  const toApartment = after?.apartmentId ?? null;
  if (!residentId || raw(fromApartment) === raw(toApartment)) return;

  const residentName = await residentLabel(residentId, manager);
  await save(manager, {
    entityType: 'resident',
    entityId: residentId,
    entityLabel: residentName,
    action: 'updated',
    changes: [
      {
        field: 'apartments',
        label: 'Apartamento asignado',
        from: fromApartment
          ? await apartmentLabel(fromApartment, manager)
          : null,
        to: toApartment ? await apartmentLabel(toApartment, manager) : null,
        kind: 'text',
      },
    ],
  });
}

/**
 * repository.update() no pasa por el subscriber con el estado anterior; este
 * helper lo lee antes y después para que el cambio quede en el historial.
 */
export async function trackedUpdate<T extends ObjectLiteral>(
  repository: Repository<T>,
  id: string,
  values: QueryDeepPartialEntity<T>,
): Promise<void> {
  const where = { id } as unknown as FindOptionsWhere<T>;
  const before = await repository.findOne({ where });
  await repository.update(id, values);
  const after = await repository.findOne({ where });
  await recordEntityChange(
    repository.manager,
    repository.target as EntityClass,
    'updated',
    before as Row | null,
    after as Row | null,
  );
}
