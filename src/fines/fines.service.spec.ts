import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { FinesService } from './fines.service';
import { Fine } from './entities/fine.entity';
import { FineType } from './entities/fine-type.entity';
import { Apartment } from '../apartments/entities/apartment.entity';
import { Resident } from '../residents/entities/resident.entity';
import { NotificationType } from '../notification-types/entities/notification-type.entity';
import { NotificationsService } from '../notifications/notifications.service';

const mockQb = (items: unknown[], total: number) => {
  const qb: Record<string, jest.Mock> = {};
  const chainMethods = ['leftJoinAndSelect', 'orderBy', 'andWhere', 'skip', 'take'];
  for (const m of chainMethods) {
    qb[m] = jest.fn().mockReturnValue(qb);
  }
  qb['getManyAndCount'] = jest.fn().mockResolvedValue([items, total]);
  qb['getMany'] = jest.fn().mockResolvedValue(items);
  return qb;
};

const makeRepo = (items: unknown[], total?: number) => ({
  findAndCount: jest.fn().mockResolvedValue([items, total ?? items.length]),
  findOne: jest.fn(),
  find: jest.fn().mockResolvedValue(items),
  count: jest.fn().mockResolvedValue(items.length),
  create: jest.fn(),
  save: jest.fn(),
  createQueryBuilder: jest.fn().mockReturnValue(mockQb(items, total ?? items.length)),
});

describe('FinesService.findAll', () => {
  let service: FinesService;
  let repo: ReturnType<typeof makeRepo>;

  const mockItems = Array.from({ length: 55 }, (_, i) => ({ id: `id-${i}` }));

  beforeEach(async () => {
    repo = makeRepo(mockItems.slice(0, 15), 55);
    const moduleRef = await Test.createTestingModule({
      providers: [
        FinesService,
        { provide: getRepositoryToken(Fine), useValue: repo },
        { provide: getRepositoryToken(FineType), useValue: makeRepo([]) },
        { provide: getRepositoryToken(Apartment), useValue: makeRepo([]) },
        { provide: getRepositoryToken(Resident), useValue: makeRepo([]) },
        { provide: getRepositoryToken(NotificationType), useValue: makeRepo([]) },
        { provide: NotificationsService, useValue: { create: jest.fn() } },
      ],
    }).compile();
    service = moduleRef.get(FinesService);
  });

  it('returns paginated data with correct meta', async () => {
    const result = await service.findAll({}, { page: 1, limit: 15 });
    expect(result.data).toHaveLength(15);
    expect(result.meta.total).toBe(55);
    expect(result.meta.totalPages).toBe(4);
  });

  it('applies skip/take via QueryBuilder', async () => {
    await service.findAll({}, { page: 3, limit: 15 });
    const qb = repo.createQueryBuilder.mock.results[0].value;
    expect(qb.skip).toHaveBeenCalledWith(30);
    expect(qb.take).toHaveBeenCalledWith(15);
  });

  it('defaults to page=1 limit=15', async () => {
    await service.findAll();
    const qb = repo.createQueryBuilder.mock.results[0].value;
    expect(qb.skip).toHaveBeenCalledWith(0);
    expect(qb.take).toHaveBeenCalledWith(15);
  });
});
