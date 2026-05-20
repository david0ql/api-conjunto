import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EmployeesService } from './employees.service';
import { Employee } from './entities/employee.entity';

const makeRepo = (items: Employee[], total?: number) => ({
  findAndCount: jest.fn().mockResolvedValue([items, total ?? items.length]),
  findOne: jest.fn(),
  find: jest.fn().mockResolvedValue(items),
  create: jest.fn(),
  save: jest.fn(),
  update: jest.fn(),
  remove: jest.fn(),
});

describe('EmployeesService.findAll', () => {
  let service: EmployeesService;
  let repo: ReturnType<typeof makeRepo>;

  const mockItems = Array.from({ length: 20 }, (_, i) => ({ id: `id-${i}` } as Employee));

  beforeEach(async () => {
    repo = makeRepo(mockItems.slice(0, 15), 20);
    const moduleRef = await Test.createTestingModule({
      providers: [
        EmployeesService,
        { provide: getRepositoryToken(Employee), useValue: repo },
      ],
    }).compile();
    service = moduleRef.get(EmployeesService);
  });

  it('returns paginated data with correct meta', async () => {
    const result = await service.findAll({ page: 1, limit: 15 });
    expect(result.data).toHaveLength(15);
    expect(result.meta.total).toBe(20);
    expect(result.meta.totalPages).toBe(2);
  });

  it('passes skip/take to repository', async () => {
    await service.findAll({ page: 2, limit: 10 });
    expect(repo.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 10, take: 10 }),
    );
  });

  it('defaults to page=1 limit=15', async () => {
    await service.findAll();
    expect(repo.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 15 }),
    );
  });
});
