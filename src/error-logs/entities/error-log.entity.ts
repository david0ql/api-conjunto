import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('error_logs')
export class ErrorLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text' })
  message: string;

  @Column({ type: 'text', nullable: true })
  stack: string;

  @Column({ name: 'screen', length: 100, nullable: true })
  screen: string;

  @Column({ name: 'device_info', type: 'text', nullable: true })
  deviceInfo: string;

  @Column({ name: 'app_version', length: 20, nullable: true })
  appVersion: string;

  @Column({ name: 'user_id', length: 50, nullable: true })
  userId: string;

  @Column({ name: 'user_type', length: 20, nullable: true })
  userType: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
