import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { CallsService } from './calls.service';
import { CallSession } from './entities/call-session.entity';
import { CallTraceEvent } from './entities/call-trace-event.entity';
import { Apartment } from '../apartments/entities/apartment.entity';
import { Employee } from '../employees/entities/employee.entity';
import { Resident } from '../residents/entities/resident.entity';
import { ResidentApartment } from '../resident-apartments/entities/resident-apartment.entity';

const makeRepo = (items: unknown[], total?: number) => ({
  findAndCount: jest.fn().mockResolvedValue([items, total ?? items.length]),
  findOne: jest.fn(),
  find: jest.fn().mockResolvedValue(items),
  count: jest.fn().mockResolvedValue(items.length),
  exist: jest.fn().mockResolvedValue(false),
  create: jest.fn(),
  save: jest.fn(),
  createQueryBuilder: jest.fn().mockReturnValue({ innerJoinAndSelect: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(), andWhere: jest.fn().mockReturnThis(), orderBy: jest.fn().mockReturnThis(), getMany: jest.fn().mockResolvedValue(items), getOne: jest.fn() }),
});

describe('CallsService.getCallHistory', () => {
  let service: CallsService;
  let callSessionRepo: ReturnType<typeof makeRepo>;

  const mockCalls = Array.from({ length: 25 }, (_, i) => ({
    id: `call-${i}`,
    status: 'ended',
    direction: 'outbound',
    createdAt: new Date(),
    targetResidentIds: [],
    targetEmployeeIds: [],
    rejectedResidentIds: [],
    rejectedEmployeeIds: [],
  } as unknown as CallSession));

  beforeEach(async () => {
    callSessionRepo = makeRepo(mockCalls.slice(0, 15), 25);
    const moduleRef = await Test.createTestingModule({
      providers: [
        CallsService,
        { provide: getRepositoryToken(CallSession), useValue: callSessionRepo },
        { provide: getRepositoryToken(CallTraceEvent), useValue: makeRepo([]) },
        { provide: getRepositoryToken(Apartment), useValue: makeRepo([]) },
        { provide: getRepositoryToken(Employee), useValue: makeRepo([]) },
        { provide: getRepositoryToken(Resident), useValue: makeRepo([]) },
        { provide: getRepositoryToken(ResidentApartment), useValue: makeRepo([]) },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(null) } },
      ],
    }).compile();
    service = moduleRef.get(CallsService);
  });

  it('returns paginated data with correct meta', async () => {
    const result = await service.getCallHistory({ page: 1, limit: 15 });
    expect(result.data).toHaveLength(15);
    expect(result.meta.total).toBe(25);
    expect(result.meta.totalPages).toBe(2);
  });

  it('passes skip/take to findAndCount', async () => {
    await service.getCallHistory({ page: 2, limit: 15 });
    expect(callSessionRepo.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 15, take: 15 }),
    );
  });

  it('defaults to page=1 limit=15', async () => {
    await service.getCallHistory();
    expect(callSessionRepo.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 15 }),
    );
  });
});
