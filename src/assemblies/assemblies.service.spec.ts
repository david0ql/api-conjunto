import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AssembliesService } from './assemblies.service';
import { Assembly } from './entities/assembly.entity';
import { AssemblyQuestion } from './entities/assembly-question.entity';
import { AssemblyVote } from './entities/assembly-vote.entity';
import { AssemblyResidentToken } from './entities/assembly-resident-token.entity';
import { Resident } from '../residents/entities/resident.entity';

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
  findOne: jest.fn().mockResolvedValue(items[0] ?? null),
  find: jest.fn().mockResolvedValue(items),
  count: jest.fn().mockResolvedValue(items.length),
  create: jest.fn(),
  save: jest.fn(),
});

describe('AssembliesService.findAll', () => {
  let service: AssembliesService;
  let repo: ReturnType<typeof makeRepo>;

  const mockAssemblies = Array.from({ length: 12 }, (_, i) => ({
    id: `asm-${i}`,
    title: `Assembly ${i}`,
    createdAt: new Date(),
    status: 'finished',
  } as Assembly));

  beforeEach(async () => {
    repo = makeRepo(mockAssemblies.slice(0, 10), 12);
    // Override findOne to simulate buildPayload succeeding
    repo.findOne.mockImplementation(({ where }: { where: { id: string } }) =>
      Promise.resolve(mockAssemblies.find((a) => a.id === where.id) ?? null),
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        AssembliesService,
        { provide: getRepositoryToken(Assembly), useValue: repo },
        { provide: getRepositoryToken(AssemblyQuestion), useValue: makeRepo([]) },
        { provide: getRepositoryToken(AssemblyVote), useValue: makeRepo([]) },
        { provide: getRepositoryToken(AssemblyResidentToken), useValue: makeRepo([]) },
        { provide: getRepositoryToken(Resident), useValue: makeRepo([]) },
      ],
    }).compile();
    service = moduleRef.get(AssembliesService);
  });

  it('returns paginated data with correct meta', async () => {
    const result = await service.findAll({ page: 1, limit: 10 });
    expect(result.data).toHaveLength(10);
    expect(result.meta.total).toBe(12);
    expect(result.meta.totalPages).toBe(2);
  });

  it('passes skip/take to the query', async () => {
    await service.findAll({ page: 2, limit: 10 });
    const qb = repo.createQueryBuilder.mock.results[0].value;
    expect(qb.skip).toHaveBeenCalledWith(10);
    expect(qb.take).toHaveBeenCalledWith(10);
  });

  it('defaults to page=1 limit=15', async () => {
    // createQueryBuilder always returns the same mock query builder.
    const qb = repo.createQueryBuilder();
    qb.getManyAndCount.mockResolvedValueOnce([[], 0]);
    await service.findAll();
    expect(qb.skip).toHaveBeenCalledWith(0);
    expect(qb.take).toHaveBeenCalledWith(15);
  });
});
