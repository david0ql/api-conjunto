import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn } from 'typeorm';
import { Resident } from '../../residents/entities/resident.entity';
import { CommonArea } from '../../common-areas/entities/common-area.entity';
import { ReservationStatus } from '../../reservation-statuses/entities/reservation-status.entity';

@Entity('reservations')
export class Reservation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Resident, { eager: false })
  @JoinColumn({ name: 'resident_id' })
  resident: Resident;

  @Column({ name: 'resident_id' })
  residentId: string;

  @ManyToOne(() => CommonArea, { eager: true })
  @JoinColumn({ name: 'area_id' })
  area: CommonArea;

  @Column({ name: 'area_id' })
  areaId: string;

  @Column({ name: 'reservation_date', type: 'date' })
  reservationDate: string;

  @Column({ name: 'start_time', type: 'time' })
  startTime: string;

  @Column({ name: 'end_time', type: 'time' })
  endTime: string;

  @ManyToOne(() => ReservationStatus, { eager: true })
  @JoinColumn({ name: 'status_id' })
  status: ReservationStatus;

  @Column({ name: 'status_id' })
  statusId: string;

  @Column({ name: 'notes_by_administrator', type: 'text', nullable: true })
  notesByAdministrator: string;

  @Column({ name: 'notes_by_resident', type: 'text', nullable: true })
  notesByResident: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
