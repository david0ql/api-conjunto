import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { Resident } from '../../residents/entities/resident.entity';
import { Visitor } from '../../visitors/entities/visitor.entity';
import { Vehicle } from '../../vehicles/entities/vehicle.entity';
import { Apartment } from '../../apartments/entities/apartment.entity';
import { Employee } from '../../employees/entities/employee.entity';
import { VehicleBrand } from '../../vehicle-brands/entities/vehicle-brand.entity';

export const ACCESS_ENTRY_TYPES = ['pedestrian', 'car', 'motorcycle', 'other'] as const;
export type AccessEntryType = (typeof ACCESS_ENTRY_TYPES)[number];

@Entity('access_audit')
export class AccessAudit {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Resident, { nullable: true, eager: false })
  @JoinColumn({ name: 'resident_id' })
  resident: Resident;

  @Column({ name: 'resident_id', nullable: true })
  residentId: string | null;

  @ManyToOne(() => Visitor, { nullable: true, eager: false })
  @JoinColumn({ name: 'visitor_id' })
  visitor: Visitor;

  @Column({ name: 'visitor_id', nullable: true })
  visitorId: string | null;

  @ManyToOne(() => Vehicle, { nullable: true, eager: false })
  @JoinColumn({ name: 'vehicle_id' })
  vehicle: Vehicle;

  @Column({ name: 'vehicle_id', nullable: true })
  vehicleId: string | null;

  @ManyToOne(() => Apartment, { nullable: true, eager: false })
  @JoinColumn({ name: 'apartment_id' })
  apartment: Apartment;

  @Column({ name: 'apartment_id', nullable: true })
  apartmentId: string | null;

  @Column({ name: 'entry_time', type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  entryTime: Date;

  @Column({ name: 'entry_type', type: 'varchar', length: 20, default: 'pedestrian' })
  entryType: AccessEntryType;

  @ManyToOne(() => VehicleBrand, { nullable: true, eager: false })
  @JoinColumn({ name: 'vehicle_brand_id' })
  vehicleBrand: VehicleBrand;

  @Column({ name: 'vehicle_brand_id', nullable: true })
  vehicleBrandId: string | null;

  @Column({ name: 'vehicle_color', length: 40, nullable: true })
  vehicleColor: string | null;

  @Column({ name: 'vehicle_plate', length: 15, nullable: true })
  vehiclePlate: string | null;

  @Column({ name: 'vehicle_model', length: 60, nullable: true })
  vehicleModel: string | null;

  @Column({ name: 'visitor_photo_path', nullable: true })
  visitorPhotoPath: string | null;

  @Column({ name: 'exit_time', type: 'timestamptz', nullable: true })
  exitTime: Date | null;

  @ManyToOne(() => Employee, { nullable: true, eager: false })
  @JoinColumn({ name: 'authorized_by_employee_id' })
  authorizedByEmployee: Employee;

  @Column({ name: 'authorized_by_employee_id', nullable: true })
  authorizedByEmployeeId: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;
}
