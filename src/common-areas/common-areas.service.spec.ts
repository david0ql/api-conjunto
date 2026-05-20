import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CommonAreasService } from './common-areas.service';
import { CommonArea } from './entities/common-area.entity';
import { Reservation } from '../reservations/entities/reservation.entity';

const makeRepo = (items: unknown[], total?: number) => ({
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

  it('passes skip/take to repository', async () => {
    await service.findAll({ page: 1, limit: 5 });
    expect(repo.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 5 }),
    );
  });

  it('defaults to page=1 limit=15', async () => {
    await service.findAll();
    expect(repo.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 15 }),
    );
  });
});
