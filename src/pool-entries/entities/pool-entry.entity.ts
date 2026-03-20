import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, OneToMany } from 'typeorm';
import { Employee } from '../../employees/entities/employee.entity';
import { PoolEntryGuest } from './pool-entry-guest.entity';
import { PoolEntryResident } from './pool-entry-resident.entity';
import { Apartment } from '../../apartments/entities/apartment.entity';
import { Resident } from '../../residents/entities/resident.entity';

@Entity('pool_entries')
export class PoolEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Apartment, { eager: false })
  @JoinColumn({ name: 'apartment_id' })
  apartment: Apartment;

  @Column({ name: 'apartment_id' })
  apartmentId: string;

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

  @OneToMany(() => PoolEntryGuest, (guest) => guest.poolEntry, {
    cascade: true,
    eager: true,
  })
  guests: PoolEntryGuest[];

  @OneToMany(() => PoolEntryResident, (residentLink) => residentLink.poolEntry, {
    cascade: true,
    eager: true,
  })
  residentLinks: PoolEntryResident[];

  residents?: Resident[];
}
