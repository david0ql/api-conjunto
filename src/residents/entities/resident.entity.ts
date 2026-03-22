import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn } from 'typeorm';
import { ResidentType } from '../../resident-types/entities/resident-type.entity';
import { Apartment } from '../../apartments/entities/apartment.entity';

@Entity('residents')
export class Resident {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 50 })
  name: string;

  @Column({ name: 'last_name', length: 50 })
  lastName: string;

  @Column({ length: 50, unique: true })
  document: string;

  @Column({ length: 20, nullable: true })
  phone: string;

  @Column({ length: 100, unique: true, nullable: true })
  email: string;

  @Column({ name: 'password_hash', type: 'text', select: false })
  passwordHash: string;

  @ManyToOne(() => ResidentType, { eager: true })
  @JoinColumn({ name: 'resident_type_id' })
  residentType: ResidentType;

  @Column({ name: 'resident_type_id' })
  residentTypeId: string;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @ManyToOne(() => Apartment, { nullable: true, eager: false })
  @JoinColumn({ name: 'apartment_id' })
  apartment: Apartment;

  @Column({ name: 'apartment_id', nullable: true })
  apartmentId: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
