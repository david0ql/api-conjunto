import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotificationsService } from './notifications.service';
import { Notification } from './entities/notification.entity';
import { ResidentApartment } from '../resident-apartments/entities/resident-apartment.entity';
import { Resident } from '../residents/entities/resident.entity';
import { CallsPushService } from '../calls/calls-push.service';

const makeRepo = (items: unknown[], total?: number) => ({
  findAndCount: jest.fn().mockResolvedValue([items, total ?? items.length]),
  findOne: jest.fn(),
  find: jest.fn().mockResolvedValue(items),
  create: jest.fn(),
  save: jest.fn(),
  remove: jest.fn(),
  createQueryBuilder: jest.fn().mockReturnValue({ leftJoinAndSelect: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(), orWhere: jest.fn().mockReturnThis(), orderBy: jest.fn().mockReturnThis(), getMany: jest.fn().mockResolvedValue(items) }),
});

describe('NotificationsService.findAll', () => {
  let service: NotificationsService;
  let repo: ReturnType<typeof makeRepo>;

  const mockItems = Array.from({ length: 30 }, (_, i) => ({ id: `id-${i}` }));

  beforeEach(async () => {
    repo = makeRepo(mockItems.slice(0, 15), 30);
    const moduleRef = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: getRepositoryToken(Notification), useValue: repo },
        { provide: getRepositoryToken(ResidentApartment), useValue: makeRepo([]) },
        { provide: getRepositoryToken(Resident), useValue: makeRepo([]) },
        { provide: CallsPushService, useValue: { sendResidentNotification: jest.fn() } },
      ],
    }).compile();
    service = moduleRef.get(NotificationsService);
  });

  it('returns paginated data with correct meta', async () => {
    const result = await service.findAll({ page: 1, limit: 15 });
    expect(result.data).toHaveLength(15);
    expect(result.meta.total).toBe(30);
    expect(result.meta.totalPages).toBe(2);
  });

  it('passes skip/take to repository', async () => {
    await service.findAll({ page: 2, limit: 15 });
    expect(repo.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 15, take: 15 }),
    );
  });

  it('defaults to page=1 limit=15', async () => {
    await service.findAll();
    expect(repo.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 15 }),
    );
  });
});
