import { Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { Apartment } from '../../apartments/entities/apartment.entity';

@Entity('towers')
export class Tower {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 10, unique: true })
  code: string;

  @Column({ length: 80 })
  name: string;

  @Column({ name: 'total_floors', type: 'int' })
  totalFloors: number;

  @Column({ name: 'apartments_per_floor', type: 'int' })
  apartmentsPerFloor: number;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @OneToMany(() => Apartment, (apartment) => apartment.towerData)
  apartments: Apartment[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
