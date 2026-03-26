import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Apartment } from '../../apartments/entities/apartment.entity';
import { Employee } from '../../employees/entities/employee.entity';
import { Resident } from '../../residents/entities/resident.entity';

export type CallSessionStatus = 'ringing' | 'active' | 'ended' | 'missed' | 'rejected';

@Entity('call_sessions')
export class CallSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Apartment, { eager: false })
  @JoinColumn({ name: 'apartment_id' })
  apartment: Apartment;

  @Column({ name: 'apartment_id' })
  apartmentId: string;

  @ManyToOne(() => Employee, { eager: false })
  @JoinColumn({ name: 'initiated_by_employee_id' })
  initiatedByEmployee: Employee;

  @Column({ name: 'initiated_by_employee_id' })
  initiatedByEmployeeId: string;

  @ManyToOne(() => Resident, { eager: false, nullable: true })
  @JoinColumn({ name: 'accepted_by_resident_id' })
  acceptedByResident: Resident | null;

  @Column({ name: 'accepted_by_resident_id', type: 'uuid', nullable: true })
  acceptedByResidentId: string | null;

  @Column({ length: 20, default: 'ringing' })
  status: CallSessionStatus;

  @Column({ name: 'target_resident_ids', type: 'simple-json' })
  targetResidentIds: string[];

  @Column({ name: 'rejected_resident_ids', type: 'simple-json', nullable: true })
  rejectedResidentIds: string[] | null;

  @Column({ name: 'ended_by_user_id', type: 'uuid', nullable: true })
  endedByUserId: string | null;

  @Column({ name: 'ended_by_user_type', type: 'varchar', length: 20, nullable: true })
  endedByUserType: 'employee' | 'resident' | null;

  @Column({ name: 'ended_reason', type: 'varchar', length: 40, nullable: true })
  endedReason: string | null;

  @Column({ name: 'accepted_at', type: 'timestamptz', nullable: true })
  acceptedAt: Date | null;

  @Column({ name: 'ended_at', type: 'timestamptz', nullable: true })
  endedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
