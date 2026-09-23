import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Apartment } from '../../apartments/entities/apartment.entity';
import { Employee } from '../../employees/entities/employee.entity';
import { Resident } from '../../residents/entities/resident.entity';

export type CallQueueEntryStatus = 'waiting' | 'served' | 'cancelled' | 'expired';

/**
 * A resident who called a busy porter and waits for the porter to call back.
 * Position = order among the porter's `waiting` entries by creation time.
 */
@Entity('call_queue_entries')
@Index(['employeeId', 'status', 'createdAt'])
@Index(['employeeId', 'residentId'], {
  unique: true,
  where: `"status" = 'waiting'`,
})
export class CallQueueEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Employee, { eager: false })
  @JoinColumn({ name: 'employee_id' })
  employee: Employee;

  @Column({ name: 'employee_id', type: 'uuid' })
  employeeId: string;

  @ManyToOne(() => Resident, { eager: false })
  @JoinColumn({ name: 'resident_id' })
  resident: Resident;

  @Column({ name: 'resident_id', type: 'uuid' })
  residentId: string;

  @ManyToOne(() => Apartment, { eager: false, nullable: true })
  @JoinColumn({ name: 'apartment_id' })
  apartment: Apartment | null;

  @Column({ name: 'apartment_id', type: 'uuid', nullable: true })
  apartmentId: string | null;

  @Column({ type: 'varchar', length: 20, default: 'waiting' })
  status: CallQueueEntryStatus;

  /** Last position the resident was told about (avoids repeated notifications). */
  @Column({ name: 'notified_position', type: 'integer', nullable: true })
  notifiedPosition: number | null;

  @Column({ name: 'served_call_id', type: 'uuid', nullable: true })
  servedCallId: string | null;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
