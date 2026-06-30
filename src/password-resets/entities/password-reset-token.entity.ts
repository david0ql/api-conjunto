import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Resident } from '../../residents/entities/resident.entity';
import { Employee } from '../../employees/entities/employee.entity';

/**
 * One-time, short-lived token for an admin-initiated resident password reset.
 *
 * Security notes:
 * - We never store the raw token. Only its SHA-256 hash lives here; the raw value
 *   exists exclusively inside the email link. A DB leak therefore cannot be used
 *   to reset anyone's password.
 * - Single use: `usedAt` is stamped atomically when consumed.
 * - Short lived: see `expiresAt` (TTL configured via PASSWORD_RESET_TTL_MINUTES).
 */
@Entity('password_reset_tokens')
export class PasswordResetToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Resident, { nullable: false, eager: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'resident_id' })
  resident: Resident;

  @Index()
  @Column({ name: 'resident_id', type: 'uuid' })
  residentId: string;

  /** SHA-256 hex digest of the raw token (the raw token never touches the DB). */
  @Column({ name: 'token_hash', type: 'char', length: 64, unique: true })
  tokenHash: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'used_at', type: 'timestamptz', nullable: true })
  usedAt: Date | null;

  @ManyToOne(() => Employee, { nullable: true, eager: false })
  @JoinColumn({ name: 'requested_by_employee_id' })
  requestedByEmployee?: Employee;

  @Column({ name: 'requested_by_employee_id', type: 'uuid', nullable: true })
  requestedByEmployeeId: string | null;

  @Column({ name: 'request_ip', type: 'varchar', length: 64, nullable: true })
  requestIp: string | null;

  @Column({ name: 'consumed_ip', type: 'varchar', length: 64, nullable: true })
  consumedIp: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
