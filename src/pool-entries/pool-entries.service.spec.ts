import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PoolEntriesService } from './pool-entries.service';
import { PoolEntry } from './entities/pool-entry.entity';
import { PoolEntryGuest } from './entities/pool-entry-guest.entity';
import { PoolEntryResident } from './entities/pool-entry-resident.entity';
import { Apartment } from '../apartments/entities/apartment.entity';
import { Resident } from '../residents/entities/resident.entity';

const makeRepo = (items: unknown[], total?: number) => ({
  findAndCount: jest.fn().mockResolvedValue([items, total ?? items.length]),
  findOne: jest.fn(),
  find: jest.fn().mockResolvedValue(items),
  create: jest.fn(),
  save: jest.fn(),
  remove: jest.fn(),
  createQueryBuilder: jest.fn().mockReturnValue({ leftJoinAndSelect: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(), orderBy: jest.fn().mockReturnThis(), getMany: jest.fn().mockResolvedValue(items), getOne: jest.fn() }),
});

describe('PoolEntriesService.findAll', () => {
  let service: PoolEntriesService;
  let repo: ReturnType<typeof makeRepo>;

  const mockItems = Array.from({ length: 35 }, (_, i) => ({ id: `id-${i}`, residentLinks: [], guests: [] }));

  beforeEach(async () => {
    repo = makeRepo(mockItems.slice(0, 15), 35);
    const moduleRef = await Test.createTestingModule({
      providers: [
        PoolEntriesService,
        { provide: getRepositoryToken(PoolEntry), useValue: repo },
        { provide: getRepositoryToken(PoolEntryGuest), useValue: makeRepo([]) },
        { provide: getRepositoryToken(PoolEntryResident), useValue: makeRepo([]) },
        { provide: getRepositoryToken(Apartment), useValue: makeRepo([]) },
        { provide: getRepositoryToken(Resident), useValue: makeRepo([]) },
      ],
    }).compile();
    service = moduleRef.get(PoolEntriesService);
  });

  it('returns paginated data with correct meta', async () => {
    const result = await service.findAll({ page: 1, limit: 15 });
    expect(result.data).toHaveLength(15);
    expect(result.meta.total).toBe(35);
    expect(result.meta.totalPages).toBe(3);
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
