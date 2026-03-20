import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { Resident } from '../../residents/entities/resident.entity';
import { Employee } from '../../employees/entities/employee.entity';

@Entity('pool_entries')
export class PoolEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Resident, { eager: false })
  @JoinColumn({ name: 'resident_id' })
  resident: Resident;

  @Column({ name: 'resident_id' })
  residentId: string;

  @Column({ name: 'entry_time', type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  entryTime: Date;

  @Column({ name: 'guest_count', default: 0 })
  guestCount: number;

  @ManyToOne(() => Employee, { nullable: true, eager: false })
  @JoinColumn({ name: 'created_by_employee_id' })
  createdByEmployee: Employee;

  @Column({ name: 'created_by_employee_id', nullable: true })
  createdByEmployeeId: string;

  @Column({ type: 'text', nullable: true })
  notes: string;
}
