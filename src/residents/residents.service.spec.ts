import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ResidentsService } from './residents.service';
import { Resident } from './entities/resident.entity';
import { ResidentApartment } from '../resident-apartments/entities/resident-apartment.entity';

const mockQb = (items: unknown[], total: number) => {
  const qb: Record<string, jest.Mock> = {
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getManyAndCount: jest.fn().mockResolvedValue([items, total]),
    getOne: jest.fn(),
  };
  for (const key of Object.keys(qb)) {
    if (key !== 'getManyAndCount' && key !== 'getOne') {
      qb[key] = qb[key].mockReturnValue(qb);
    }
  }
  return qb;
};

const makeRepo = (items: unknown[], total?: number) => ({
  findAndCount: jest.fn().mockResolvedValue([items, total ?? items.length]),
  findOne: jest.fn(),
  find: jest.fn().mockResolvedValue(items),
  count: jest.fn().mockResolvedValue(items.length),
  create: jest.fn(),
  save: jest.fn(),
  remove: jest.fn(),
  query: jest.fn(),
  update: jest.fn(),
  createQueryBuilder: jest.fn().mockReturnValue(mockQb(items, total ?? items.length)),
});

describe('ResidentsService.findAll', () => {
  let service: ResidentsService;
  let repo: ReturnType<typeof makeRepo>;

  const mockItems = Array.from({ length: 50 }, (_, i) => ({ id: `id-${i}` }));

  beforeEach(async () => {
    repo = makeRepo(mockItems.slice(0, 15), 50);
    const moduleRef = await Test.createTestingModule({
      providers: [
        ResidentsService,
        { provide: getRepositoryToken(Resident), useValue: repo },
        { provide: getRepositoryToken(ResidentApartment), useValue: makeRepo([]) },
      ],
    }).compile();
    service = moduleRef.get(ResidentsService);
  });

  it('returns paginated data with correct meta', async () => {
    const result = await service.findAll(undefined, { page: 1, limit: 15 });
    expect(result.data).toHaveLength(15);
    expect(result.meta.total).toBe(50);
    expect(result.meta.totalPages).toBe(4);
  });

  it('applies skip/take via QueryBuilder', async () => {
    await service.findAll(undefined, { page: 3, limit: 10 });
    const qb = repo.createQueryBuilder.mock.results[0].value;
    expect(qb.skip).toHaveBeenCalledWith(20);
    expect(qb.take).toHaveBeenCalledWith(10);
  });

  it('defaults to page=1 limit=15', async () => {
    await service.findAll();
    const qb = repo.createQueryBuilder.mock.results[0].value;
    expect(qb.skip).toHaveBeenCalledWith(0);
    expect(qb.take).toHaveBeenCalledWith(15);
  });

  it('filters by apartmentId when provided', async () => {
    await service.findAll('apt-123', { page: 1, limit: 15 });
    const qb = repo.createQueryBuilder.mock.results[0].value;
    expect(qb.where).toHaveBeenCalledWith('r.apartment_id = :apartmentId', { apartmentId: 'apt-123' });
  });
});
