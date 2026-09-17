import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, Repository } from 'typeorm';
import { NotificationType } from '../notification-types/entities/notification-type.entity';
import { Notification } from '../notifications/entities/notification.entity';
import { CallsPushService } from './calls-push.service';
import { CallsService } from './calls.service';
import type { CallSessionPayload } from './calls.types';
import { CallQueueEntry } from './entities/call-queue-entry.entity';

const CALL_QUEUE_LOCK = 734_220_902;
const QUEUE_NOTIFICATION_TYPE = 'call_queue';
const QUEUE_TITLE = 'Fila de portería';

export interface CallQueueItemPayload {
  id: string;
  position: number;
  employee: { id: string; name: string; lastName: string };
  resident: { id: string; name: string; lastName: string; phone: string | null };
  apartment: {
    id: string;
    number: string;
    tower: { id: string; code: string; name: string } | null;
  } | null;
  createdAt: string;
}

/**
 * Waiting list for busy porters (callback model, works with the published
 * app): a resident who calls a busy porter is queued and told their position
 * by notification; when the porter is free again they are told who is next
 * and call that apartment back; the connected callback serves the entry.
 */
@Injectable()
export class CallQueueService implements OnModuleInit, OnModuleDestroy {
  static readonly MAX_WAIT_MS = 30 * 60_000;

  private readonly logger = new Logger(CallQueueService.name);
  private readonly listeners = new Set<() => void>();
  private expiryInterval: NodeJS.Timeout | null = null;
  private notificationTypeId: string | null = null;

  constructor(
    @InjectRepository(CallQueueEntry)
    private readonly entries: Repository<CallQueueEntry>,
    @InjectRepository(Notification)
    private readonly notifications: Repository<Notification>,
    @InjectRepository(NotificationType)
    private readonly notificationTypes: Repository<NotificationType>,
    private readonly callsService: CallsService,
    private readonly callsPushService: CallsPushService,
  ) {}

  onModuleInit() {
    this.expiryInterval = setInterval(() => void this.expireStale(), 60_000);
    this.expiryInterval.unref();
  }

  onModuleDestroy() {
    if (this.expiryInterval) clearInterval(this.expiryInterval);
  }

  /** Called whenever the waiting list changes (the gateway broadcasts it to staff). */
  onChange(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async enqueue(residentId: string, employeeId: string) {
    const apartmentIds =
      await this.callsService.getApartmentIdsForResident(residentId);
    const { entry, alreadyWaiting } = await this.entries.manager.transaction(
      async (manager) => {
        await manager.query('SELECT pg_advisory_xact_lock($1)', [
          CALL_QUEUE_LOCK,
        ]);
        const repository = manager.getRepository(CallQueueEntry);
        const existing = await repository.findOne({
          where: { employeeId, residentId, status: 'waiting' },
        });
        if (existing) return { entry: existing, alreadyWaiting: true };
        const created = await repository.save(
          repository.create({
            employeeId,
            residentId,
            apartmentId: apartmentIds[0] ?? null,
            status: 'waiting',
          }),
        );
        return { entry: created, alreadyWaiting: false };
      },
    );

    const position = await this.positionOf(entry);
    await this.notifyResident(
      entry,
      `Portería está ocupada. Estás de ${position}.º en la fila; el portero te devolverá la llamada.`,
      position,
    );
    this.changed();
    return { entryId: entry.id, position, alreadyWaiting };
  }

  async list(): Promise<CallQueueItemPayload[]> {
    const rows = await this.entries.find({
      where: { status: 'waiting' },
      relations: ['employee', 'resident', 'apartment', 'apartment.towerData'],
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    const positions = new Map<string, number>();
    return rows.map((row) => {
      const position = (positions.get(row.employeeId) ?? 0) + 1;
      positions.set(row.employeeId, position);
      return {
        id: row.id,
        position,
        employee: {
          id: row.employee.id,
          name: row.employee.name,
          lastName: row.employee.lastName,
        },
        resident: {
          id: row.resident.id,
          name: row.resident.name,
          lastName: row.resident.lastName,
          phone: row.resident.phone ?? null,
        },
        apartment: row.apartment
          ? {
              id: row.apartment.id,
              number: row.apartment.number,
              tower: row.apartment.towerData
                ? {
                    id: row.apartment.towerData.id,
                    code: row.apartment.towerData.code,
                    name: row.apartment.towerData.name,
                  }
                : null,
            }
          : null,
        createdAt: row.createdAt.toISOString(),
      };
    });
  }

  async cancel(entryId: string) {
    const entry = await this.entries.findOne({ where: { id: entryId } });
    if (!entry) throw new NotFoundException('Turno no encontrado');
    const result = await this.entries.update(
      { id: entryId, status: 'waiting' },
      { status: 'cancelled', resolvedAt: new Date() },
    );
    if (!result.affected) return;
    await this.notifyResident(
      entry,
      'Portería retiró tu turno de la fila. Si aún lo necesitas, vuelve a llamar.',
      null,
    );
    await this.refreshPositions([entry.employeeId]);
    this.changed();
  }

  /** A connected call with the resident (or their apartment) serves their turn. */
  async onCallAccepted(call: CallSessionPayload) {
    try {
      const residentIds = [call.acceptedByResidentId, call.initiatedByResidentId]
        .filter((id): id is string => Boolean(id));
      const waiting = await this.entries.find({ where: { status: 'waiting' } });
      const served = waiting.filter(
        (entry) =>
          residentIds.includes(entry.residentId) ||
          (call.direction === 'outbound' &&
            Boolean(call.apartmentId) &&
            entry.apartmentId === call.apartmentId),
      );
      if (served.length === 0) return;

      await this.entries.update(
        { id: In(served.map((entry) => entry.id)), status: 'waiting' },
        { status: 'served', servedCallId: call.id, resolvedAt: new Date() },
      );
      await this.refreshPositions(served.map((entry) => entry.employeeId));
      this.changed();
    } catch (error) {
      this.logger.warn(`No fue posible actualizar la fila: ${this.message(error)}`);
    }
  }

  /** When a porter becomes free, tell them who is next. */
  async onCallFinished(call: CallSessionPayload) {
    try {
      const employeeIds = Array.from(
        new Set(
          [call.initiatedByEmployeeId, call.acceptedByEmployeeId, ...(call.targetEmployeeIds ?? [])]
            .filter((id): id is string => Boolean(id)),
        ),
      );
      for (const employeeId of employeeIds) {
        const queue = (await this.list()).filter((item) => item.employee.id === employeeId);
        if (queue.length === 0) continue;
        if (await this.callsService.isEmployeeBusy(employeeId)) continue;
        const next = queue[0];
        const apartment = next.apartment
          ? `Apto ${next.apartment.number}${next.apartment.tower ? ` · ${next.apartment.tower.name}` : ''}`
          : 'Sin apartamento';
        await this.callsPushService.sendUserNotification({
          userType: 'employee',
          userIds: [employeeId],
          notificationId: `call-queue-${next.id}-${Date.now()}`,
          title: QUEUE_TITLE,
          body: `Siguiente: ${apartment} – ${next.resident.name} ${next.resident.lastName}. ${queue.length} en espera.`,
          notificationTypeCode: QUEUE_NOTIFICATION_TYPE,
        });
      }
    } catch (error) {
      this.logger.warn(`No fue posible avisar la fila al portero: ${this.message(error)}`);
    }
  }

  async expireStale(now = new Date()) {
    try {
      const stale = await this.entries.find({
        where: {
          status: 'waiting',
          createdAt: LessThan(new Date(now.getTime() - CallQueueService.MAX_WAIT_MS)),
        },
      });
      if (stale.length === 0) return;
      await this.entries.update(
        { id: In(stale.map((entry) => entry.id)), status: 'waiting' },
        { status: 'expired', resolvedAt: now },
      );
      for (const entry of stale) {
        await this.notifyResident(
          entry,
          'Tu turno en la fila de portería venció. Si aún lo necesitas, vuelve a llamar.',
          null,
        );
      }
      await this.refreshPositions(stale.map((entry) => entry.employeeId));
      this.changed();
    } catch (error) {
      this.logger.warn(`No fue posible vencer turnos: ${this.message(error)}`);
    }
  }

  private async positionOf(entry: CallQueueEntry) {
    // Compared in SQL: created_at has microseconds, a JS Date only milliseconds.
    const [row] = (await this.entries.query(
      `SELECT COUNT(*)::int AS ahead
         FROM call_queue_entries other
         JOIN call_queue_entries mine ON mine.id = $1
        WHERE other.employee_id = mine.employee_id
          AND other.status = 'waiting'
          AND (other.created_at < mine.created_at
               OR (other.created_at = mine.created_at AND other.id < mine.id))`,
      [entry.id],
    )) as Array<{ ahead: number }>;
    return row.ahead + 1;
  }

  /** Tells every resident whose position improved. */
  private async refreshPositions(employeeIds: string[]) {
    for (const employeeId of new Set(employeeIds)) {
      const waiting = await this.entries.find({
        where: { employeeId, status: 'waiting' },
        order: { createdAt: 'ASC', id: 'ASC' },
      });
      for (const [index, entry] of waiting.entries()) {
        const position = index + 1;
        if (entry.notifiedPosition !== null && entry.notifiedPosition <= position) continue;
        await this.notifyResident(
          entry,
          position === 1
            ? 'Eres el siguiente en la fila de portería; el portero te llamará en cuanto se desocupe.'
            : `Avanzaste en la fila de portería: ahora estás de ${position}.º.`,
          position,
        );
      }
    }
  }

  private async notifyResident(entry: CallQueueEntry, message: string, position: number | null) {
    try {
      const typeId = await this.getNotificationTypeId();
      const saved = await this.notifications.save(
        this.notifications.create({
          residentId: entry.residentId,
          apartmentId: entry.apartmentId as string,
          notificationTypeId: typeId,
          message,
          isRead: false,
        }),
      );
      if (position !== null) {
        await this.entries.update(entry.id, { notifiedPosition: position });
        entry.notifiedPosition = position;
      }
      await this.callsPushService.sendResidentNotification({
        targetResidentIds: [entry.residentId],
        notificationId: saved.id,
        title: QUEUE_TITLE,
        body: message,
        notificationTypeCode: QUEUE_NOTIFICATION_TYPE,
      });
    } catch (error) {
      this.logger.warn(`No fue posible notificar la fila: ${this.message(error)}`);
    }
  }

  private async getNotificationTypeId() {
    if (this.notificationTypeId) return this.notificationTypeId;
    await this.notificationTypes
      .createQueryBuilder()
      .insert()
      .into(NotificationType)
      .values({
        code: QUEUE_NOTIFICATION_TYPE,
        name: QUEUE_TITLE,
        description: 'Turnos de residentes que esperan que portería les devuelva la llamada',
      })
      .orIgnore()
      .execute();
    const type = await this.notificationTypes.findOneOrFail({
      where: { code: QUEUE_NOTIFICATION_TYPE },
    });
    this.notificationTypeId = type.id;
    return type.id;
  }

  private changed() {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // A broken listener must not affect the call flow.
      }
    }
  }

  private message(error: unknown) {
    return error instanceof Error ? error.message : 'Unknown error';
  }
}
