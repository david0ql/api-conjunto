import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CommonAreasService } from './common-areas.service';
import { CommonArea } from './entities/common-area.entity';
import { Reservation } from '../reservations/entities/reservation.entity';

const mockQb = (items: unknown[], total: number) => ({
  andWhere: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  take: jest.fn().mockReturnThis(),
  getManyAndCount: jest.fn().mockResolvedValue([items, total]),
});

const makeRepo = (items: unknown[], total?: number) => ({
  createQueryBuilder: jest.fn().mockReturnValue(mockQb(items, total ?? items.length)),
  findAndCount: jest.fn().mockResolvedValue([items, total ?? items.length]),
  findOne: jest.fn(),
  find: jest.fn().mockResolvedValue(items),
  count: jest.fn().mockResolvedValue(0),
  create: jest.fn(),
  save: jest.fn(),
  remove: jest.fn(),
});

describe('CommonAreasService.findAll', () => {
  let service: CommonAreasService;
  let repo: ReturnType<typeof makeRepo>;

  const mockItems = Array.from({ length: 8 }, (_, i) => ({ id: `id-${i}` }));

  beforeEach(async () => {
    repo = makeRepo(mockItems, 8);
    const moduleRef = await Test.createTestingModule({
      providers: [
        CommonAreasService,
        { provide: getRepositoryToken(CommonArea), useValue: repo },
        { provide: getRepositoryToken(Reservation), useValue: makeRepo([]) },
      ],
    }).compile();
    service = moduleRef.get(CommonAreasService);
  });

  it('returns paginated data with correct meta', async () => {
    const result = await service.findAll({ page: 1, limit: 15 });
    expect(result.data).toHaveLength(8);
    expect(result.meta.total).toBe(8);
    expect(result.meta.totalPages).toBe(1);
  });

  it('passes skip/take to the query', async () => {
    await service.findAll({ page: 1, limit: 5 });
    const qb = repo.createQueryBuilder.mock.results[0].value;
    expect(qb.skip).toHaveBeenCalledWith(0);
    expect(qb.take).toHaveBeenCalledWith(5);
  });

  it('defaults to page=1 limit=15', async () => {
    await service.findAll();
    const qb = repo.createQueryBuilder.mock.results[0].value;
    expect(qb.skip).toHaveBeenCalledWith(0);
    expect(qb.take).toHaveBeenCalledWith(15);
  });

  it('filters by every word of the search', async () => {
    await service.findAll({ search: 'Salón Social' });
    const qb = repo.createQueryBuilder.mock.results[0].value;
    expect(qb.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('area.name'),
      { search_0: '%salon%', search_1: '%social%' },
    );
  });
});
