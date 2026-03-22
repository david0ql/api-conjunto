import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { Resident } from '../../residents/entities/resident.entity';
import { Employee } from '../../employees/entities/employee.entity';
import { Apartment } from '../../apartments/entities/apartment.entity';

@Entity('packages')
export class Package {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Apartment, { nullable: true, eager: false })
  @JoinColumn({ name: 'apartment_id' })
  apartment: Apartment;

  @Column({ name: 'apartment_id', nullable: true })
  apartmentId: string;

  @ManyToOne(() => Resident, { nullable: true, eager: false })
  @JoinColumn({ name: 'resident_id' })
  resident: Resident;

  @Column({ name: 'resident_id', nullable: true })
  residentId: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ name: 'arrival_time', type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  arrivalTime: Date;

  @Column({ default: false })
  delivered: boolean;

  @Column({ name: 'delivered_time', type: 'timestamptz', nullable: true })
  deliveredTime: Date;

  @ManyToOne(() => Resident, { nullable: true, eager: false })
  @JoinColumn({ name: 'received_by_resident_id' })
  receivedByResident: Resident;

  @Column({ name: 'received_by_resident_id', nullable: true })
  receivedByResidentId: string;

  @ManyToOne(() => Employee, { nullable: true, eager: false })
  @JoinColumn({ name: 'created_by_employee_id' })
  createdByEmployee: Employee;

  @Column({ name: 'created_by_employee_id', nullable: true })
  createdByEmployeeId: string;
}
