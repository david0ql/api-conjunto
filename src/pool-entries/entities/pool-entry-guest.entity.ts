import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { PoolEntry } from './pool-entry.entity';

@Entity('pool_entry_guests')
export class PoolEntryGuest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => PoolEntry, (poolEntry) => poolEntry.guests, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'pool_entry_id' })
  poolEntry: PoolEntry;

  @Column({ name: 'pool_entry_id' })
  poolEntryId: string;

  @Column({ length: 80 })
  name: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
