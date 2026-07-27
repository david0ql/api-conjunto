import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, Index } from 'typeorm';
import { Apartment } from '../../apartments/entities/apartment.entity';
import { VehicleBrand } from '../../vehicle-brands/entities/vehicle-brand.entity';
import { Employee } from '../../employees/entities/employee.entity';

// Una placa identifica un vehículo único dentro del conjunto: no puede repetirse
// ni en el mismo apartamento ni en otro. La placa se guarda siempre normalizada
// (mayúsculas, "ABC 123"), por lo que el índice basta para blindar la regla a
// nivel de base de datos; el servicio además la valida para dar un mensaje útil.
@Entity('resident_vehicles')
@Index('UQ_resident_vehicles_plate', ['plate'], { unique: true })
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

  @Column({ name: 'vehicle_type', type: 'varchar', length: 20, default: 'motorcycle' })
  vehicleType: string;

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
