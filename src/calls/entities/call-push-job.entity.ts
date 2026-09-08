import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import type { CallSessionPayload } from '../calls.types';

export type CallPushJobStatus = 'pending' | 'processing' | 'sent' | 'failed';
export type CallPushEvent = 'incoming' | 'accepted' | 'ended' | 'missed' | 'rejected';
export type CallPushChannel = 'fcm' | 'hms' | 'voip';

@Entity('call_push_jobs')
@Index(['callSessionId', 'event', 'channel'], { unique: true })
@Index(['status', 'nextAttemptAt'])
export class CallPushJob {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'call_session_id', type: 'uuid' })
  callSessionId: string;

  @Column({ type: 'varchar', length: 20 })
  event: CallPushEvent;

  @Column({ type: 'varchar', length: 20 })
  channel: CallPushChannel;

  @Column({ type: 'simple-json' })
  payload: CallSessionPayload;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status: CallPushJobStatus;

  @Column({ type: 'integer', default: 0 })
  attempts: number;

  @Column({ name: 'next_attempt_at', type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  nextAttemptAt: Date;

  @Column({ name: 'locked_at', type: 'timestamptz', nullable: true })
  lockedAt: Date | null;

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt: Date | null;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
