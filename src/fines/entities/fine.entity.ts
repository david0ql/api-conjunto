import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Resident } from '../../residents/entities/resident.entity';
import { Employee } from '../../employees/entities/employee.entity';
import { FineType } from './fine-type.entity';

const DecimalTransformer = {
  to(value: number | null | undefined) {
    return value;
  },
  from(value: string | null): number | null {
    if (value == null) return null;
    return Number(value);
  },
};

@Entity('fines')
export class Fine {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'resident_id' })
  residentId: string;

  @ManyToOne(() => Resident, { nullable: false, eager: false })
  @JoinColumn({ name: 'resident_id' })
  resident: Resident;

  @Column({ name: 'fine_type_id' })
  fineTypeId: string;

  @ManyToOne(() => FineType, { nullable: false, eager: false })
  @JoinColumn({ name: 'fine_type_id' })
  fineType: FineType;

  @Column({
    type: 'numeric',
    precision: 12,
    scale: 2,
    transformer: DecimalTransformer,
  })
  amount: number;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ name: 'created_by_employee_id' })
  createdByEmployeeId: string;

  @ManyToOne(() => Employee, { nullable: false, eager: false })
  @JoinColumn({ name: 'created_by_employee_id' })
  createdByEmployee: Employee;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
