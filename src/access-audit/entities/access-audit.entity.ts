import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { Resident } from '../../residents/entities/resident.entity';
import { Visitor } from '../../visitors/entities/visitor.entity';
import { Vehicle } from '../../vehicles/entities/vehicle.entity';
import { Apartment } from '../../apartments/entities/apartment.entity';
import { Employee } from '../../employees/entities/employee.entity';

@Entity('access_audit')
export class AccessAudit {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Resident, { nullable: true, eager: false })
  @JoinColumn({ name: 'resident_id' })
  resident: Resident;

  @Column({ name: 'resident_id', nullable: true })
  residentId: string;

  @ManyToOne(() => Visitor, { nullable: true, eager: false })
  @JoinColumn({ name: 'visitor_id' })
  visitor: Visitor;

  @Column({ name: 'visitor_id', nullable: true })
  visitorId: string;

  @ManyToOne(() => Vehicle, { nullable: true, eager: false })
  @JoinColumn({ name: 'vehicle_id' })
  vehicle: Vehicle;

  @Column({ name: 'vehicle_id', nullable: true })
  vehicleId: string;

  @ManyToOne(() => Apartment, { nullable: true, eager: false })
  @JoinColumn({ name: 'apartment_id' })
  apartment: Apartment;

  @Column({ name: 'apartment_id', nullable: true })
  apartmentId: string;

  @Column({ name: 'entry_time', type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  entryTime: Date;

  @Column({ name: 'exit_time', type: 'timestamptz', nullable: true })
  exitTime: Date;

  @ManyToOne(() => Employee, { nullable: true, eager: false })
  @JoinColumn({ name: 'authorized_by_employee_id' })
  authorizedByEmployee: Employee;

  @Column({ name: 'authorized_by_employee_id', nullable: true })
  authorizedByEmployeeId: string;

  @Column({ type: 'text', nullable: true })
  notes: string;
}
