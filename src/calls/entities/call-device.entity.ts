import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import type { JwtPayload } from '../../common/interfaces/jwt-payload.interface';

export type CallDevicePlatform = 'android' | 'ios';
export type CallDeviceChannel = 'fcm' | 'voip';
export type CallDeviceEnvironment = 'development' | 'production';

@Entity('call_devices')
@Index(['token'], { unique: true })
@Index(['userId', 'userType'])
export class CallDevice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'user_type', type: 'varchar', length: 20 })
  userType: JwtPayload['type'];

  @Column({ type: 'varchar', length: 20 })
  platform: CallDevicePlatform;

  @Column({ type: 'varchar', length: 20 })
  channel: CallDeviceChannel;

  @Column({ type: 'text' })
  token: string;

  @Column({ name: 'push_environment', type: 'varchar', length: 20, nullable: true })
  pushEnvironment: CallDeviceEnvironment | null;

  @Column({ name: 'device_id', type: 'varchar', length: 120, nullable: true })
  deviceId: string | null;

  @Column({ name: 'app_version', type: 'varchar', length: 40, nullable: true })
  appVersion: string | null;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @Column({ name: 'last_seen_at', type: 'timestamptz', nullable: true })
  lastSeenAt: Date | null;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
