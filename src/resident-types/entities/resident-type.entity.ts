import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('resident_types')
export class ResidentType {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 30, unique: true })
  code: string;

  @Column({ length: 50 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string;
}
