import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import {
  DataSource,
  EntitySubscriberInterface,
  InsertEvent,
  ObjectLiteral,
  RemoveEvent,
  UpdateEvent,
} from 'typeorm';
import { isTrackedEntity, recordEntityChange } from './change-recorder';

/**
 * Registra en el historial todo save()/remove() sobre las entidades
 * rastreadas, venga del módulo que venga (portería, app móvil, registros
 * masivos...). Los repository.update() no traen el estado anterior, así que
 * esos puntos usan trackedUpdate() explícitamente.
 */
@Injectable()
export class ChangeHistorySubscriber implements EntitySubscriberInterface {
  constructor(@InjectDataSource() dataSource: DataSource) {
    dataSource.subscribers.push(this);
  }

  async afterInsert(event: InsertEvent<ObjectLiteral>): Promise<void> {
    const target = event.metadata.target;
    if (!isTrackedEntity(target)) return;
    await recordEntityChange(event.manager, target, 'created', null, {
      ...event.entity,
    });
  }

  async afterUpdate(event: UpdateEvent<ObjectLiteral>): Promise<void> {
    const target = event.metadata.target;
    // Sin databaseEntity es un update() por query builder: no hay "antes" que comparar.
    if (!isTrackedEntity(target) || !event.databaseEntity || !event.entity)
      return;
    await recordEntityChange(
      event.manager,
      target,
      'updated',
      { ...event.databaseEntity },
      { ...event.entity },
    );
  }

  // Se registra antes de borrar (misma transacción) porque después TypeORM
  // limpia el id de la entidad.
  async beforeRemove(event: RemoveEvent<ObjectLiteral>): Promise<void> {
    const target = event.metadata.target;
    const snapshot = event.databaseEntity ?? event.entity;
    if (!isTrackedEntity(target) || !snapshot) return;
    await recordEntityChange(
      event.manager,
      target,
      'deleted',
      { ...snapshot },
      null,
    );
  }
}
