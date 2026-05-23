import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { RegistrationRequest } from './registration-request.entity';

@Entity('registration_request_persons')
export class RegistrationRequestPerson {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => RegistrationRequest, (r) => r.persons, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'request_id' })
  request: RegistrationRequest;

  @Column({ name: 'request_id' })
  requestId: string;

  @Column({ name: 'sort_order', default: 0 })
  sortOrder: number;

  @Column({ length: 50 })
  name: string;

  @Column({ name: 'last_name', length: 50 })
  lastName: string;

  @Column({ length: 50 })
  document: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  phone?: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  email?: string | null;

  @Column({ name: 'birth_date', type: 'date', nullable: true })
  birthDate?: string | null;

  @Column({ name: 'is_owner', default: false })
  isOwner: boolean;

  @Column({ name: 'photo_path', type: 'text', nullable: true })
  photoPath?: string | null;
}
