import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn } from 'typeorm';
import { Employee } from '../../employees/entities/employee.entity';
import { NewsCategory } from '../../news-categories/entities/news-category.entity';

@Entity('news')
export class News {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 200 })
  title: string;

  @Column({ type: 'text' })
  content: string;

  @Column({ name: 'published_at', type: 'timestamptz' })
  publishedAt: Date;

  @ManyToOne(() => NewsCategory, { eager: false })
  @JoinColumn({ name: 'category_id' })
  category: NewsCategory;

  @Column({ name: 'category_id' })
  categoryId: string;

  @ManyToOne(() => Employee, { eager: false })
  @JoinColumn({ name: 'created_by_employee_id' })
  createdByEmployee: Employee;

  @Column({ name: 'created_by_employee_id' })
  createdByEmployeeId: string;

  @Column({ name: 'image_url', type: 'text', nullable: true })
  imageUrl: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
