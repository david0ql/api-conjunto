import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { CommunitySpace } from './community-space.entity';

@Entity('community_space_schedules')
@Unique('uq_community_space_day', ['communitySpaceId', 'dayOfWeek'])
export class CommunitySpaceSchedule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => CommunitySpace, (space) => space.schedules, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'community_space_id' })
  communitySpace: CommunitySpace;

  @Column({ name: 'community_space_id', type: 'uuid' })
  communitySpaceId: string;

  @Column({ name: 'day_of_week', type: 'int2' })
  dayOfWeek: number;

  @Column({ name: 'is_open', default: false })
  isOpen: boolean;

  @Column({ name: 'start_time', type: 'time', nullable: true })
  startTime: string | null;

  @Column({ name: 'end_time', type: 'time', nullable: true })
  endTime: string | null;
}
