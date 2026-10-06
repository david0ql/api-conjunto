import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('visitors')
export class Visitor {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 50 })
  name: string;

  @Column({ name: 'last_name', length: 50 })
  lastName: string;

  @Column({ length: 50, nullable: true })
  document: string;

  @Column({ length: 20, nullable: true })
  phone: string;

  @Column({ name: 'photo_path', type: 'varchar', length: 255, nullable: true })
  photoPath: string | null;

  @Column({ name: 'photo_updated_at', type: 'timestamptz', nullable: true })
  photoUpdatedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  /** Último ingreso del visitante; lo llena VisitorsService en los listados (no es columna). */
  lastAccess?: VisitorLastAccess | null;
}

export interface VisitorLastAccess {
  entryTime: Date;
  exitTime: Date | null;
  visitorCategory: string;
  apartment: {
    id: string;
    number: string;
    tower: { id: string; code: string; name: string } | null;
  } | null;
  porter: { id: string; name: string; lastName: string } | null;
}
