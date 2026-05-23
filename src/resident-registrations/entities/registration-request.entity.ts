import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { RegistrationLink } from './registration-link.entity';
import { RegistrationRequestPerson } from './registration-request-person.entity';
import { RegistrationRequestVehicle } from './registration-request-vehicle.entity';
import { Tower } from '../../towers/entities/tower.entity';
import { Apartment } from '../../apartments/entities/apartment.entity';
import { Employee } from '../../employees/entities/employee.entity';

export type RegistrationRequestStatus = 'pending' | 'approved' | 'rejected';

@Entity('registration_requests')
export class RegistrationRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => RegistrationLink, { onDelete: 'CASCADE', eager: false })
  @JoinColumn({ name: 'link_id' })
  link: RegistrationLink;

  @Column({ name: 'link_id' })
  linkId: string;

  @ManyToOne(() => Tower, { eager: true })
  @JoinColumn({ name: 'tower_id' })
  tower: Tower;

  @Column({ name: 'tower_id' })
  towerId: string;

  @ManyToOne(() => Apartment, { eager: true })
  @JoinColumn({ name: 'apartment_id' })
  apartment: Apartment;

  @Column({ name: 'apartment_id' })
  apartmentId: string;

  @Column({ name: 'receipt_photo_path', type: 'text', nullable: true })
  receiptPhotoPath?: string | null;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status: RegistrationRequestStatus;

  @Column({ name: 'rejection_reason', type: 'text', nullable: true })
  rejectionReason?: string | null;

  @ManyToOne(() => Employee, { nullable: true, eager: false })
  @JoinColumn({ name: 'reviewed_by_employee_id' })
  reviewedByEmployee?: Employee;

  @Column({ name: 'reviewed_by_employee_id', type: 'uuid', nullable: true })
  reviewedByEmployeeId?: string | null;

  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
  reviewedAt?: Date | null;

  @Column({ name: 'submitted_lat', type: 'float', nullable: true })
  submittedLat?: number | null;

  @Column({ name: 'submitted_lng', type: 'float', nullable: true })
  submittedLng?: number | null;

  @OneToMany(() => RegistrationRequestPerson, (p) => p.request, { cascade: true, eager: true })
  persons: RegistrationRequestPerson[];

  @OneToMany(() => RegistrationRequestVehicle, (v) => v.request, { cascade: true, eager: true })
  vehicles: RegistrationRequestVehicle[];

  @CreateDateColumn({ name: 'submitted_at', type: 'timestamptz' })
  submittedAt: Date;
}
