import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Employee } from '../../employees/entities/employee.entity';

@Entity('registration_links')
export class RegistrationLink {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'public_id', type: 'uuid', unique: true, default: () => 'gen_random_uuid()' })
  publicId: string;

  @Column({ length: 100 })
  label: string;

  @Column({ name: 'geofence_lat', type: 'float' })
  geofenceLat: number;

  @Column({ name: 'geofence_lng', type: 'float' })
  geofenceLng: number;

  @Column({ name: 'geofence_radius_m', type: 'int' })
  geofenceRadiusM: number;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @ManyToOne(() => Employee, { nullable: true, eager: false })
  @JoinColumn({ name: 'created_by_employee_id' })
  createdByEmployee?: Employee;

  @Column({ name: 'created_by_employee_id', nullable: true })
  createdByEmployeeId?: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
