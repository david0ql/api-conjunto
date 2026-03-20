import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn } from 'typeorm';
import { Resident } from '../../residents/entities/resident.entity';
import { NotificationType } from '../../notification-types/entities/notification-type.entity';

@Entity('notifications')
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Resident, { eager: false })
  @JoinColumn({ name: 'resident_id' })
  resident: Resident;

  @Column({ name: 'resident_id' })
  residentId: string;

  @ManyToOne(() => NotificationType, { eager: true })
  @JoinColumn({ name: 'notification_type_id' })
  notificationType: NotificationType;

  @Column({ name: 'notification_type_id' })
  notificationTypeId: string;

  @Column({ type: 'text' })
  message: string;

  @Column({ name: 'is_read', default: false })
  isRead: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
