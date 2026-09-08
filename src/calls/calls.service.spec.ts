import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { ConflictException } from '@nestjs/common';
import { CallsService } from './calls.service';
import { CallSession } from './entities/call-session.entity';
import { CallTraceEvent } from './entities/call-trace-event.entity';
import { Apartment } from '../apartments/entities/apartment.entity';
import { Employee } from '../employees/entities/employee.entity';
import { Resident } from '../residents/entities/resident.entity';
import { ResidentApartment } from '../resident-apartments/entities/resident-apartment.entity';

const makeRepo = (items: unknown[], total?: number) => {
  const qb = {
    innerJoinAndSelect: jest.fn().mockReturnThis(),
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({ affected: 1 }),
    orderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(items),
    getOne: jest.fn(),
    getManyAndCount: jest
      .fn()
      .mockResolvedValue([items, total ?? items.length]),
  };
  return {
    __qb: qb,
    findAndCount: jest.fn().mockResolvedValue([items, total ?? items.length]),
    findOne: jest.fn(),
    find: jest.fn().mockResolvedValue(items),
    count: jest.fn().mockResolvedValue(items.length),
    exist: jest.fn().mockResolvedValue(false),
    create: jest.fn(),
    save: jest.fn(),
    createQueryBuilder: jest.fn().mockReturnValue(qb),
  };
};

describe('CallsService.getCallHistory', () => {
  let service: CallsService;
  let callSessionRepo: ReturnType<typeof makeRepo>;

  const mockCalls = Array.from(
    { length: 25 },
    (_, i) =>
      ({
        id: `call-${i}`,
        status: 'ended',
        direction: 'outbound',
        createdAt: new Date(),
        targetResidentIds: [],
        targetEmployeeIds: [],
        rejectedResidentIds: [],
        rejectedEmployeeIds: [],
      }) as unknown as CallSession,
  );

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
        {
          provide: getRepositoryToken(ResidentApartment),
          useValue: makeRepo([]),
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue(null) },
        },
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
    expect(callSessionRepo.__qb.skip).toHaveBeenCalledWith(15);
    expect(callSessionRepo.__qb.take).toHaveBeenCalledWith(15);
  });

  it('defaults to page=1 limit=15', async () => {
    await service.getCallHistory();
    expect(callSessionRepo.__qb.skip).toHaveBeenCalledWith(0);
    expect(callSessionRepo.__qb.take).toHaveBeenCalledWith(15);
  });

  it('does not reactivate a terminal call when a delayed accept arrives', async () => {
    const endedCall = {
      id: 'ended-call',
      direction: 'outbound',
      status: 'ended',
      targetResidentIds: ['resident-1'],
      acceptedByResidentId: 'resident-1',
      endedAt: new Date(),
      endedReason: 'completed',
    } as unknown as CallSession;
    callSessionRepo.findOne.mockResolvedValue(endedCall);

    await expect(
      service.acceptCall('ended-call', { id: 'resident-1', type: 'resident' }),
    ).rejects.toThrow(ConflictException);
    expect(callSessionRepo.save).not.toHaveBeenCalled();
  });

  it('allows only one atomic transition from ringing to active', async () => {
    callSessionRepo.findOne.mockResolvedValue({
      id: 'ringing-call',
      direction: 'outbound',
      status: 'ringing',
      targetResidentIds: ['resident-1'],
      acceptedByResidentId: null,
    } as unknown as CallSession);
    callSessionRepo.__qb.execute.mockResolvedValueOnce({ affected: 0 });

    await expect(
      service.acceptCall('ringing-call', { id: 'resident-1', type: 'resident' }),
    ).rejects.toThrow(ConflictException);
    expect(callSessionRepo.__qb.andWhere).toHaveBeenCalledWith(
      'status = :status',
      { status: 'ringing' },
    );
    expect(callSessionRepo.save).not.toHaveBeenCalled();
  });

  it('expires only ringing calls returned by the durable expiry query', async () => {
    callSessionRepo.find.mockResolvedValue([
      { id: 'expired-1' },
      { id: 'expired-2' },
    ]);
    const timeout = jest
      .spyOn(service, 'timeoutCall')
      .mockResolvedValueOnce({ id: 'expired-1' } as never)
      .mockResolvedValueOnce(null);

    const result = await service.expireRingingCalls(
      new Date('2026-09-08T20:00:00Z'),
    );

    expect(timeout).toHaveBeenNthCalledWith(1, 'expired-1');
    expect(timeout).toHaveBeenNthCalledWith(2, 'expired-2');
    expect(result).toEqual([{ id: 'expired-1' }]);
    expect(callSessionRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'ringing' }),
      }),
    );
  });
});
