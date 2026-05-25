import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Visitor } from '../../visitors/entities/visitor.entity';
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

  @ManyToOne(() => Visitor, { nullable: true, eager: false })
  @JoinColumn({ name: 'visitor_id' })
  visitor: Visitor | null;

  @Column({ name: 'visitor_id', nullable: true })
  visitorId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
