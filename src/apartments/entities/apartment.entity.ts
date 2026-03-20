import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, Unique } from 'typeorm';
import { ApartmentStatus } from '../../apartment-statuses/entities/apartment-status.entity';
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

  @ManyToOne(() => ApartmentStatus, { eager: true })
  @JoinColumn({ name: 'status_id' })
  status: ApartmentStatus;

  @Column({ name: 'status_id' })
  statusId: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
