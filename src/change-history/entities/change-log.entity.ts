import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type ChangeAction = 'created' | 'updated' | 'deleted';

export interface ChangeLogField {
  /** Propiedad de la entidad (apartmentId, plate...). */
  field: string;
  /** Nombre visible en español ("Apartamento", "Placa"...). */
  label: string;
  /** Valor legible antes / después (null = vacío); en fotos, la ruta del archivo. */
  from: string | null;
  to: string | null;
  /** Cómo mostrar el valor: texto, fecha ISO o foto. */
  kind?: 'text' | 'date' | 'photo';
}

/**
 * Historial de cambios de registros operativos (vehículos, visitantes,
 * paquetes, residentes). Guarda quién hizo el cambio, cuándo y qué valores
 * había antes y después, ya en texto legible para no depender de registros
 * relacionados que luego pueden cambiar o borrarse.
 */
@Entity('change_logs')
@Index('IDX_change_logs_entity', ['entityType', 'entityId', 'createdAt'])
@Index('IDX_change_logs_type_created', ['entityType', 'createdAt'])
export class ChangeLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'entity_type', type: 'varchar', length: 40 })
  entityType: string;

  @Column({ name: 'entity_id', type: 'uuid' })
  entityId: string;

  /** Cómo se llamaba el registro al momento del cambio (placa, nombre...). */
  @Column({
    name: 'entity_label',
    type: 'varchar',
    length: 200,
    nullable: true,
  })
  entityLabel: string | null;

  @Column({ type: 'varchar', length: 20 })
  action: ChangeAction;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  changes: ChangeLogField[];

  @Column({ type: 'text', nullable: true })
  reason: string | null;

  @Column({ name: 'actor_type', type: 'varchar', length: 20 })
  actorType: 'employee' | 'resident' | 'system';

  @Column({ name: 'actor_id', type: 'uuid', nullable: true })
  actorId: string | null;

  @Column({ name: 'actor_name', type: 'varchar', length: 120, nullable: true })
  actorName: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
