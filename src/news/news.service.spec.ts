import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NewsService } from './news.service';
import { News } from './entities/news.entity';

const mockQb = (items: unknown[], total: number) => ({
  leftJoinAndSelect: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  take: jest.fn().mockReturnThis(),
  getManyAndCount: jest.fn().mockResolvedValue([items, total]),
  getMany: jest.fn().mockResolvedValue(items),
});

const makeRepo = (items: unknown[], total?: number) => ({
  findAndCount: jest.fn().mockResolvedValue([items, total ?? items.length]),
  findOne: jest.fn(),
  find: jest.fn().mockResolvedValue(items),
  create: jest.fn(),
  save: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  createQueryBuilder: jest.fn().mockReturnValue(mockQb(items, total ?? items.length)),
});

describe('NewsService.findAll', () => {
  let service: NewsService;
  let repo: ReturnType<typeof makeRepo>;

  const mockItems = Array.from({ length: 40 }, (_, i) => ({ id: `id-${i}` }));

  beforeEach(async () => {
    repo = makeRepo(mockItems.slice(0, 15), 40);
    const moduleRef = await Test.createTestingModule({
      providers: [
        NewsService,
        { provide: getRepositoryToken(News), useValue: repo },
      ],
    }).compile();
    service = moduleRef.get(NewsService);
  });

  it('returns paginated data with correct meta', async () => {
    const result = await service.findAll({ page: 1, limit: 15 });
    expect(result.data).toHaveLength(15);
    expect(result.meta.total).toBe(40);
    expect(result.meta.totalPages).toBe(3);
  });

  it('uses QueryBuilder with skip/take', async () => {
    await service.findAll({ page: 2, limit: 10 });
    const qb = repo.createQueryBuilder.mock.results[0].value;
    expect(qb.skip).toHaveBeenCalledWith(10);
    expect(qb.take).toHaveBeenCalledWith(10);
  });

  it('defaults to page=1 limit=15', async () => {
    await service.findAll();
    const qb = repo.createQueryBuilder.mock.results[0].value;
    expect(qb.skip).toHaveBeenCalledWith(0);
    expect(qb.take).toHaveBeenCalledWith(15);
  });
});
