import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, OneToMany } from 'typeorm';
import { CommunitySpaceSchedule } from './community-space-schedule.entity';

@Entity('community_spaces')
export class CommunitySpace {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 100 })
  name: string;

  @Column({ length: 50 })
  phase: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @OneToMany(() => CommunitySpaceSchedule, (schedule) => schedule.communitySpace, {
    cascade: ['insert', 'update'],
    eager: true,
  })
  schedules: CommunitySpaceSchedule[];
}
