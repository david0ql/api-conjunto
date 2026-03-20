import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn } from 'typeorm';
import { VehicleType } from '../../vehicle-types/entities/vehicle-type.entity';
import { Resident } from '../../residents/entities/resident.entity';

@Entity('vehicles')
export class Vehicle {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 10, unique: true })
  plate: string;

  @ManyToOne(() => VehicleType, { eager: true })
  @JoinColumn({ name: 'vehicle_type_id' })
  vehicleType: VehicleType;

  @Column({ name: 'vehicle_type_id' })
  vehicleTypeId: string;

  @ManyToOne(() => Resident, { eager: false })
  @JoinColumn({ name: 'resident_id' })
  resident: Resident;

  @Column({ name: 'resident_id' })
  residentId: string;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
