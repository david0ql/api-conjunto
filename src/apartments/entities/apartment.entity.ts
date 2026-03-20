import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, Unique } from 'typeorm';
import { ApartmentStatus } from '../../apartment-statuses/entities/apartment-status.entity';

@Entity('apartments')
@Unique(['tower', 'number'])
export class Apartment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 10 })
  number: string;

  @Column({ length: 10, nullable: true })
  tower: string;

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
