import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  OneToMany,
} from 'typeorm';
import { Assembly } from './assembly.entity';
import { AssemblyVote } from './assembly-vote.entity';

@Entity('assembly_questions')
export class AssemblyQuestion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Assembly, (a) => a.questions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'assembly_id' })
  assembly: Assembly;

  @Column({ name: 'assembly_id' })
  assemblyId: string;

  @Column({ type: 'text' })
  text: string;

  @Column({ type: 'int', default: 0 })
  order: number;

  @Column({ length: 20, default: 'pending' })
  status: 'pending' | 'active' | 'closed';

  @Column({ name: 'activated_at', type: 'timestamptz', nullable: true })
  activatedAt: Date | null;

  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt: Date | null;

  @OneToMany(() => AssemblyVote, (v) => v.question)
  votes: AssemblyVote[];
}
