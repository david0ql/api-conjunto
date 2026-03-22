import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, Unique } from 'typeorm';
import { Tower } from '../../towers/entities/tower.entity';

@Entity('apartments')
@Unique(['towerId', 'number'])
export class Apartment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 10 })
  number: string;

  @Column({ length: 10, nullable: true })
  tower: string;

  @ManyToOne(() => Tower, (tower) => tower.apartments, { eager: true })
  @JoinColumn({ name: 'tower_id' })
  towerData: Tower;

  @Column({ name: 'tower_id' })
  towerId: string;

  @Column({ type: 'int', nullable: true })
  floor: number;

  @Column({ type: 'numeric', precision: 10, scale: 2, nullable: true })
  area: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  // Virtual field populated by service — not a DB column
  residentCount?: number;
}
