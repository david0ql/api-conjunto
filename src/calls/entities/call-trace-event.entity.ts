import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { CallSession } from './call-session.entity';

export type CallTraceSource = 'api' | 'web' | 'mobile';
export type CallTraceLevel = 'info' | 'warn' | 'error';

@Entity('call_trace_events')
export class CallTraceEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => CallSession, { eager: false, nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'call_session_id' })
  callSession: CallSession;

  @Column({ name: 'call_session_id', type: 'uuid' })
  callSessionId: string;

  @Column({ type: 'varchar', length: 20, default: 'api' })
  source: CallTraceSource;

  @Column({ type: 'varchar', length: 20, default: 'info' })
  level: CallTraceLevel;

  @Column({ type: 'varchar', length: 80 })
  stage: string;

  @Column({ type: 'varchar', length: 240 })
  message: string;

  @Column({ name: 'actor_user_id', type: 'uuid', nullable: true })
  actorUserId: string | null;

  @Column({ name: 'actor_user_type', type: 'varchar', length: 20, nullable: true })
  actorUserType: 'employee' | 'resident' | null;

  @Column({ type: 'simple-json', nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
