import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AccessAuditService } from './access-audit.service';
import { AccessAudit } from './entities/access-audit.entity';

const makeRepo = (items: unknown[], total?: number) => ({
  findAndCount: jest.fn().mockResolvedValue([items, total ?? items.length]),
  findOne: jest.fn(),
  find: jest.fn().mockResolvedValue(items),
  create: jest.fn(),
  save: jest.fn(),
  remove: jest.fn(),
});

describe('AccessAuditService.findAll', () => {
  let service: AccessAuditService;
  let repo: ReturnType<typeof makeRepo>;

  const mockItems = Array.from({ length: 60 }, (_, i) => ({ id: `id-${i}` }));

  beforeEach(async () => {
    repo = makeRepo(mockItems.slice(0, 15), 60);
    const moduleRef = await Test.createTestingModule({
      providers: [
        AccessAuditService,
        { provide: getRepositoryToken(AccessAudit), useValue: repo },
      ],
    }).compile();
    service = moduleRef.get(AccessAuditService);
  });

  it('returns paginated data with correct meta', async () => {
    const result = await service.findAll({ page: 1, limit: 15 });
    expect(result.data).toHaveLength(15);
    expect(result.meta.total).toBe(60);
    expect(result.meta.totalPages).toBe(4);
  });

  it('passes skip/take to repository', async () => {
    await service.findAll({ page: 3, limit: 20 });
    expect(repo.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 40, take: 20 }),
    );
  });

  it('defaults to page=1 limit=15', async () => {
    await service.findAll();
    expect(repo.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 15 }),
    );
  });
});
