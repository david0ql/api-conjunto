import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn } from 'typeorm';
import { EmployeeRole } from '../../employee-roles/entities/employee-role.entity';

@Entity('employees')
export class Employee {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 50 })
  name: string;

  @Column({ name: 'last_name', length: 50 })
  lastName: string;

  @Column({ length: 50, unique: true, nullable: true })
  document: string;

  @Column({ length: 50, unique: true })
  username: string;

  @Column({ name: 'password_hash', type: 'text', select: false })
  passwordHash: string;

  @ManyToOne(() => EmployeeRole, { eager: true })
  @JoinColumn({ name: 'role_id' })
  role: EmployeeRole;

  @Column({ name: 'role_id' })
  roleId: string;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
