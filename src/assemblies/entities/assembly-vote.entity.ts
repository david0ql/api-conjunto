import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  Unique,
} from 'typeorm';
import { AssemblyQuestion } from './assembly-question.entity';
import { Resident } from '../../residents/entities/resident.entity';

@Entity('assembly_votes')
@Unique(['questionId', 'residentId'])
export class AssemblyVote {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => AssemblyQuestion, (q) => q.votes, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'question_id' })
  question: AssemblyQuestion;

  @Column({ name: 'question_id' })
  questionId: string;

  @Column({ name: 'assembly_id' })
  assemblyId: string;

  @ManyToOne(() => Resident, { nullable: false, eager: false })
  @JoinColumn({ name: 'resident_id' })
  resident: Resident;

  @Column({ name: 'resident_id' })
  residentId: string;

  @Column({ length: 10 })
  vote: 'yes' | 'no' | 'blank';

  @Column({ name: 'verification_token', length: 12 })
  verificationToken: string;

  @Column({ name: 'voted_at', type: 'timestamptz', nullable: true })
  votedAt: Date | null;

  @Column({ name: 'synced_at', type: 'timestamptz', nullable: true })
  syncedAt: Date | null;

  @Column({ length: 10, default: 'online' })
  source: 'online' | 'offline';

  @Column({ name: 'is_valid', default: true })
  isValid: boolean;

  @Column({ name: 'rejected_reason', length: 100, nullable: true })
  rejectedReason: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
