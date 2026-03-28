import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  OneToMany,
} from 'typeorm';
import { Employee } from '../../employees/entities/employee.entity';
import { AssemblyQuestion } from './assembly-question.entity';

@Entity('assemblies')
export class Assembly {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    name: 'public_id',
    type: 'uuid',
    unique: true,
    default: () => 'gen_random_uuid()',
  })
  publicId: string;

  @Column({ length: 200 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'scheduled_date', length: 10 })
  scheduledDate: string;

  @Column({ length: 20, default: 'draft' })
  status: 'draft' | 'active' | 'finished';

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt: Date | null;

  @ManyToOne(() => Employee, { nullable: false, eager: false })
  @JoinColumn({ name: 'created_by_employee_id' })
  createdByEmployee: Employee;

  @Column({ name: 'created_by_employee_id' })
  createdByEmployeeId: string;

  @OneToMany(() => AssemblyQuestion, (q) => q.assembly, { cascade: true })
  questions: AssemblyQuestion[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
