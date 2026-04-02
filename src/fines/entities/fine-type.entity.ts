import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Employee } from '../../employees/entities/employee.entity';

const DecimalTransformer = {
  to(value: number | null | undefined) {
    return value;
  },
  from(value: string | null): number | null {
    if (value == null) return null;
    return Number(value);
  },
};

@Entity('fine_types')
export class FineType {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 120, unique: true })
  name: string;

  @Column({
    type: 'numeric',
    precision: 12,
    scale: 2,
    transformer: DecimalTransformer,
  })
  value: number;

  @Column({ name: 'created_by_employee_id', nullable: true })
  createdByEmployeeId: string | null;

  @ManyToOne(() => Employee, { nullable: true, eager: false })
  @JoinColumn({ name: 'created_by_employee_id' })
  createdByEmployee: Employee;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
