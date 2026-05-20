import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PackagesService } from './packages.service';
import { Package } from './entities/package.entity';
import { PackagePhoto } from './entities/package-photo.entity';

const mockQb = (items: unknown[], total: number) => {
  const qb: Record<string, jest.Mock> = {};
  const chainMethods = ['leftJoinAndSelect', 'where', 'orderBy', 'skip', 'take', 'loadRelationCountAndMap'];
  for (const m of chainMethods) {
    qb[m] = jest.fn().mockReturnValue(qb);
  }
  qb['getManyAndCount'] = jest.fn().mockResolvedValue([items, total]);
  return qb;
};

const makeRepo = (items: unknown[], total?: number) => ({
  findAndCount: jest.fn().mockResolvedValue([items, total ?? items.length]),
  findOne: jest.fn(),
  find: jest.fn().mockResolvedValue(items),
  create: jest.fn(),
  save: jest.fn(),
  remove: jest.fn(),
  createQueryBuilder: jest.fn().mockReturnValue(mockQb(items, total ?? items.length)),
});

describe('PackagesService.findAll', () => {
  let service: PackagesService;
  let repo: ReturnType<typeof makeRepo>;

  const mockItems = Array.from({ length: 45 }, (_, i) => ({ id: `id-${i}` }));

  beforeEach(async () => {
    repo = makeRepo(mockItems.slice(0, 15), 45);
    const moduleRef = await Test.createTestingModule({
      providers: [
        PackagesService,
        { provide: getRepositoryToken(Package), useValue: repo },
        { provide: getRepositoryToken(PackagePhoto), useValue: makeRepo([]) },
      ],
    }).compile();
    service = moduleRef.get(PackagesService);
  });

  it('returns paginated data with correct meta', async () => {
    const result = await service.findAll({ page: 1, limit: 15 });
    expect(result.data).toHaveLength(15);
    expect(result.meta.total).toBe(45);
    expect(result.meta.totalPages).toBe(3);
  });

  it('applies skip/take via QueryBuilder', async () => {
    await service.findAll({ page: 2, limit: 15 });
    const qb = repo.createQueryBuilder.mock.results[0].value;
    expect(qb.skip).toHaveBeenCalledWith(15);
    expect(qb.take).toHaveBeenCalledWith(15);
  });

  it('defaults to page=1 limit=15', async () => {
    await service.findAll();
    const qb = repo.createQueryBuilder.mock.results[0].value;
    expect(qb.skip).toHaveBeenCalledWith(0);
    expect(qb.take).toHaveBeenCalledWith(15);
  });
});
