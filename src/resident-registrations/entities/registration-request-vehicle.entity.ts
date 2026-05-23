import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { RegistrationRequest } from './registration-request.entity';

@Entity('registration_request_vehicles')
export class RegistrationRequestVehicle {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => RegistrationRequest, (r) => r.vehicles, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'request_id' })
  request: RegistrationRequest;

  @Column({ name: 'request_id' })
  requestId: string;

  @Column({ name: 'vehicle_type', length: 20 })
  vehicleType: string;

  @Column({ name: 'brand_name', length: 60 })
  brandName: string;

  @Column({ length: 60, nullable: true })
  model?: string | null;

  @Column({ length: 40, nullable: true })
  color?: string | null;

  @Column({ length: 15 })
  plate: string;

  @Column({ type: 'text', nullable: true })
  notes?: string | null;
}
