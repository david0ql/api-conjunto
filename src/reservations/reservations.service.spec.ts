import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ReservationsService } from './reservations.service';
import { Reservation } from './entities/reservation.entity';
import { ReservationStatus } from '../reservation-statuses/entities/reservation-status.entity';

const makeRepo = (items: Reservation[], total?: number) => ({
  findAndCount: jest.fn().mockResolvedValue([items, total ?? items.length]),
  findOne: jest.fn(),
  find: jest.fn().mockResolvedValue(items),
  create: jest.fn(),
  save: jest.fn(),
  update: jest.fn(),
  remove: jest.fn(),
  createQueryBuilder: jest.fn().mockReturnValue({ innerJoin: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(), andWhere: jest.fn().mockReturnThis(), getOne: jest.fn() }),
});

describe('ReservationsService.findAll', () => {
  let service: ReservationsService;
  let reservationRepo: ReturnType<typeof makeRepo>;

  const mockItems = Array.from({ length: 25 }, (_, i) => ({ id: `id-${i}` } as Reservation));

  beforeEach(async () => {
    reservationRepo = makeRepo(mockItems.slice(0, 15), 25);
    const moduleRef = await Test.createTestingModule({
      providers: [
        ReservationsService,
        { provide: getRepositoryToken(Reservation), useValue: reservationRepo },
        { provide: getRepositoryToken(ReservationStatus), useValue: makeRepo([]) },
      ],
    }).compile();
    service = moduleRef.get(ReservationsService);
  });

  it('returns paginated data with correct meta', async () => {
    const result = await service.findAll({ page: 1, limit: 15 });
    expect(result.data).toHaveLength(15);
    expect(result.meta.total).toBe(25);
    expect(result.meta.page).toBe(1);
    expect(result.meta.limit).toBe(15);
    expect(result.meta.totalPages).toBe(2);
  });

  it('passes skip/take to repository', async () => {
    await service.findAll({ page: 2, limit: 10 });
    expect(reservationRepo.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 10, take: 10 }),
    );
  });

  it('defaults to page=1 limit=15 when not provided', async () => {
    await service.findAll();
    expect(reservationRepo.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 15 }),
    );
  });

  it('returns totalPages=1 when collection is empty', async () => {
    reservationRepo.findAndCount.mockResolvedValueOnce([[], 0]);
    const result = await service.findAll({ page: 1, limit: 15 });
    expect(result.meta.totalPages).toBe(1);
    expect(result.data).toHaveLength(0);
  });
});
