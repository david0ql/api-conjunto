import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ApartmentsService } from './apartments.service';
import { Apartment } from './entities/apartment.entity';
import { Tower } from '../towers/entities/tower.entity';

const makeRepo = (items: unknown[], total?: number) => ({
  findAndCount: jest.fn().mockResolvedValue([items, total ?? items.length]),
  findOne: jest.fn(),
  find: jest.fn().mockResolvedValue(items),
  count: jest.fn().mockResolvedValue(items.length),
  create: jest.fn(),
  save: jest.fn(),
  remove: jest.fn(),
  query: jest.fn().mockResolvedValue([]),
});

describe('ApartmentsService.findAll', () => {
  let service: ApartmentsService;
  let repo: ReturnType<typeof makeRepo>;

  const mockItems = Array.from({ length: 100 }, (_, i) => ({ id: `id-${i}` }));

  beforeEach(async () => {
    repo = makeRepo(mockItems.slice(0, 15), 100);
    const moduleRef = await Test.createTestingModule({
      providers: [
        ApartmentsService,
        { provide: getRepositoryToken(Apartment), useValue: repo },
        { provide: getRepositoryToken(Tower), useValue: makeRepo([]) },
      ],
    }).compile();
    service = moduleRef.get(ApartmentsService);
  });

  it('returns paginated data with correct meta', async () => {
    const result = await service.findAll(undefined, { page: 1, limit: 15 });
    expect(result.data).toHaveLength(15);
    expect(result.meta.total).toBe(100);
    expect(result.meta.totalPages).toBe(7);
  });

  it('passes skip/take to findAndCount', async () => {
    await service.findAll(undefined, { page: 2, limit: 20 });
    expect(repo.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, take: 20 }),
    );
  });

  it('filters by towerId', async () => {
    await service.findAll('tower-123', { page: 1, limit: 15 });
    expect(repo.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({ where: { towerId: 'tower-123' } }),
    );
  });

  it('defaults to page=1 limit=15', async () => {
    await service.findAll();
    expect(repo.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 15 }),
    );
  });
});
