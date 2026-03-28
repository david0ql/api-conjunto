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
export type CallDirection = 'outbound' | 'inbound' | 'internal';

@Entity('call_sessions')
export class CallSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Apartment, { eager: false, nullable: true })
  @JoinColumn({ name: 'apartment_id' })
  apartment: Apartment | null;

  @Column({ name: 'apartment_id', type: 'uuid', nullable: true })
  apartmentId: string | null;

  @Column({ name: 'direction', type: 'varchar', length: 20, default: 'outbound' })
  direction: CallDirection;

  @ManyToOne(() => Employee, { eager: false, nullable: true })
  @JoinColumn({ name: 'initiated_by_employee_id' })
  initiatedByEmployee: Employee | null;

  @Column({ name: 'initiated_by_employee_id', type: 'uuid', nullable: true })
  initiatedByEmployeeId: string | null;

  @ManyToOne(() => Resident, { eager: false, nullable: true })
  @JoinColumn({ name: 'initiated_by_resident_id' })
  initiatedByResident: Resident | null;

  @Column({ name: 'initiated_by_resident_id', type: 'uuid', nullable: true })
  initiatedByResidentId: string | null;

  @ManyToOne(() => Resident, { eager: false, nullable: true })
  @JoinColumn({ name: 'accepted_by_resident_id' })
  acceptedByResident: Resident | null;

  @Column({ name: 'accepted_by_resident_id', type: 'uuid', nullable: true })
  acceptedByResidentId: string | null;

  @ManyToOne(() => Employee, { eager: false, nullable: true })
  @JoinColumn({ name: 'accepted_by_employee_id' })
  acceptedByEmployee: Employee | null;

  @Column({ name: 'accepted_by_employee_id', type: 'uuid', nullable: true })
  acceptedByEmployeeId: string | null;

  @Column({ length: 20, default: 'ringing' })
  status: CallSessionStatus;

  @Column({ name: 'target_resident_ids', type: 'simple-json', nullable: true })
  targetResidentIds: string[] | null;

  @Column({ name: 'target_employee_ids', type: 'simple-json', nullable: true })
  targetEmployeeIds: string[] | null;

  @Column({ name: 'rejected_resident_ids', type: 'simple-json', nullable: true })
  rejectedResidentIds: string[] | null;

  @Column({ name: 'rejected_employee_ids', type: 'simple-json', nullable: true })
  rejectedEmployeeIds: string[] | null;

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
