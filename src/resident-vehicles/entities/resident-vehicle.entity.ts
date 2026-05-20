import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn } from 'typeorm';
import { Apartment } from '../../apartments/entities/apartment.entity';
import { VehicleBrand } from '../../vehicle-brands/entities/vehicle-brand.entity';
import { Employee } from '../../employees/entities/employee.entity';

@Entity('resident_vehicles')
export class ResidentVehicle {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Apartment, { nullable: false, eager: false })
  @JoinColumn({ name: 'apartment_id' })
  apartment: Apartment;

  @Column({ name: 'apartment_id', type: 'uuid' })
  apartmentId: string;

  @ManyToOne(() => VehicleBrand, { nullable: false, eager: false })
  @JoinColumn({ name: 'vehicle_brand_id' })
  vehicleBrand: VehicleBrand;

  @Column({ name: 'vehicle_brand_id', type: 'uuid' })
  vehicleBrandId: string;

  @Column({ type: 'varchar', length: 15 })
  plate: string;

  @Column({ type: 'varchar', length: 40, nullable: true })
  color: string | null;

  @Column({ type: 'varchar', length: 60, nullable: true })
  model: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @ManyToOne(() => Employee, { nullable: true, eager: false })
  @JoinColumn({ name: 'created_by_employee_id' })
  createdByEmployee: Employee;

  @Column({ name: 'created_by_employee_id', type: 'uuid', nullable: true })
  createdByEmployeeId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
