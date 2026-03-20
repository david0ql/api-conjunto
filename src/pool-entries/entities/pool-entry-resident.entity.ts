import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { PoolEntry } from './pool-entry.entity';
import { Resident } from '../../residents/entities/resident.entity';

@Entity('pool_entry_residents')
export class PoolEntryResident {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => PoolEntry, (poolEntry) => poolEntry.residentLinks, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'pool_entry_id' })
  poolEntry: PoolEntry;

  @Column({ name: 'pool_entry_id' })
  poolEntryId: string;

  @ManyToOne(() => Resident, { eager: false })
  @JoinColumn({ name: 'resident_id' })
  resident: Resident;

  @Column({ name: 'resident_id' })
  residentId: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
