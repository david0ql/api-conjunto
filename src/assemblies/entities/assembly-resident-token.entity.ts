import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  Unique,
} from 'typeorm';
import { Assembly } from './assembly.entity';
import { Resident } from '../../residents/entities/resident.entity';

@Entity('assembly_resident_tokens')
@Unique(['assemblyId', 'residentId'])
@Unique(['token'])
export class AssemblyResidentToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Assembly, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'assembly_id' })
  assembly: Assembly;

  @Column({ name: 'assembly_id' })
  assemblyId: string;

  @ManyToOne(() => Resident, { nullable: false, eager: false })
  @JoinColumn({ name: 'resident_id' })
  resident: Resident;

  @Column({ name: 'resident_id' })
  residentId: string;

  @Column({ length: 12 })
  token: string;

  @CreateDateColumn({ name: 'issued_at', type: 'timestamptz' })
  issuedAt: Date;
}
