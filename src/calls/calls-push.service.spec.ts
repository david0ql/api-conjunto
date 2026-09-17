import { CallsPushService } from './calls-push.service';
import type { CallSessionPayload } from './calls.types';

const call = {
  id: 'call-1',
  status: 'ringing',
  direction: 'inbound',
  apartmentId: null,
  apartment: null,
  initiatedByEmployeeId: null,
  initiatedByEmployee: null,
  initiatedByResidentId: 'resident-1',
  initiatedByResident: null,
  acceptedByResidentId: null,
  acceptedByResident: null,
  acceptedByEmployeeId: null,
  acceptedByEmployee: null,
  targetResidentIds: [],
  targetEmployeeIds: ['employee-1'],
  rejectedResidentIds: [],
  rejectedEmployeeIds: [],
  endedByUserId: null,
  endedByUserType: null,
  endedReason: null,
  createdAt: new Date().toISOString(),
  acceptedAt: null,
  endedAt: null,
  expiresAt: new Date(Date.now() + 45_000).toISOString(),
} satisfies CallSessionPayload;

describe('CallsPushService outbox', () => {
  const insertBuilder = {
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    into: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orIgnore: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({}),
  };
  const jobsRepository = {
    createQueryBuilder: jest.fn().mockReturnValue(insertBuilder),
    create: jest.fn((value) => value),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const manager = { query: jest.fn().mockResolvedValue([]) };
  const dataSource = {
    transaction: jest.fn((callback) => callback(manager)),
  };
  const devicesRepository = {
    find: jest.fn().mockResolvedValue([]),
    save: jest.fn().mockResolvedValue(undefined),
  };
  const callsService = {
    recordTrace: jest.fn(),
    getCallStatus: jest.fn().mockResolvedValue('ringing'),
  };
  const service = new CallsPushService(
    devicesRepository as never,
    jobsRepository as never,
    dataSource as never,
    { get: jest.fn() } as never,
    callsService as never,
  );

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    devicesRepository.find.mockResolvedValue([]);
    callsService.getCallStatus.mockResolvedValue('ringing');
  });

  it('enqueues an incoming call once through the unique call/event key', async () => {
    await service.sendIncomingCall(call);

    expect(insertBuilder.values).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ callSessionId: 'call-1', event: 'incoming', channel: 'fcm', status: 'pending' }),
        expect.objectContaining({ callSessionId: 'call-1', event: 'incoming', channel: 'hms', status: 'pending' }),
      ]),
    );
    expect(insertBuilder.orIgnore).toHaveBeenCalled();
  });

  it('claims due jobs with SKIP LOCKED', async () => {
    await (service as any).claimJobs(10);

    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('FOR UPDATE SKIP LOCKED'),
      [10],
    );
  });

  it('returns a failed delivery to pending with backoff', async () => {
    jest.spyOn(service as any, 'sendFcm').mockRejectedValueOnce(new Error('temporary'));

    await (service as any).processJob({
      id: 'job-1', event: 'incoming', channel: 'fcm', payload: call, attempts: 1,
    });

    expect(jobsRepository.update).toHaveBeenCalledWith('job-1', expect.objectContaining({
      status: 'pending', lockedAt: null, lastError: 'temporary',
    }));
  });

  it('marks a delivered job as sent', async () => {
    jest.spyOn(service as any, 'sendFcm').mockResolvedValueOnce(undefined);

    await (service as any).processJob({
      id: 'job-2', event: 'incoming', channel: 'fcm', payload: call, attempts: 1,
    });

    expect(jobsRepository.update).toHaveBeenCalledWith('job-2', expect.objectContaining({
      status: 'sent', lockedAt: null, lastError: null,
    }));
  });

  it('does not deliver an incoming push after the call deadline', async () => {
    const sendFcm = jest
      .spyOn(service as any, 'sendFcm')
      .mockResolvedValueOnce(undefined);

    await (service as any).processJob({
      id: 'job-expired',
      event: 'incoming',
      channel: 'fcm',
      payload: { ...call, expiresAt: new Date(Date.now() - 1_000).toISOString() },
      attempts: 1,
    });

    expect(sendFcm).not.toHaveBeenCalled();
    expect(jobsRepository.update).toHaveBeenCalledWith(
      'job-expired',
      expect.objectContaining({ status: 'failed', lockedAt: null }),
    );
  });

  it('marks a job failed after the retry limit', async () => {
    jest.spyOn(service as any, 'sendFcm').mockRejectedValueOnce(new Error('permanent'));

    await (service as any).processJob({
      id: 'job-3', event: 'incoming', channel: 'fcm', payload: call, attempts: 6,
    });

    expect(jobsRepository.update).toHaveBeenCalledWith('job-3', expect.objectContaining({
      status: 'failed', lastError: 'permanent',
    }));
  });

  it('recovers processing jobs abandoned by a stopped worker', async () => {
    await (service as any).recoverAbandonedJobs();

    expect(insertBuilder.set).toHaveBeenCalledWith(expect.objectContaining({
      status: 'pending', lockedAt: null,
    }));
    expect(insertBuilder.andWhere).toHaveBeenCalledWith(
      "locked_at < NOW() - INTERVAL '2 minutes'",
    );
  });

  it('drops a retried incoming push once the call is no longer ringing', async () => {
    callsService.getCallStatus.mockResolvedValueOnce('active');
    const sendFcm = jest.spyOn(service as any, 'sendFcm');

    await (service as any).processJob({
      id: 'job-answered', callSessionId: 'call-1', event: 'incoming', channel: 'fcm', payload: call, attempts: 3,
    });

    expect(sendFcm).not.toHaveBeenCalled();
    expect(jobsRepository.update).toHaveBeenCalledWith('job-answered', expect.objectContaining({ status: 'failed' }));
  });

  it('deactivates dead FCM tokens without retrying and skips already delivered tokens', async () => {
    const devices = [
      { token: 'already-rang' },
      { token: 'good' },
      { token: 'dead' },
    ];
    devicesRepository.find.mockResolvedValueOnce(devices);
    const sendEachForMulticast = jest.fn().mockResolvedValue({
      successCount: 1,
      failureCount: 1,
      responses: [
        { success: true },
        { success: false, error: { code: 'messaging/registration-token-not-registered', message: 'NotRegistered' } },
      ],
    });
    jest.spyOn(service as any, 'getMessagingClient').mockReturnValue({ sendEachForMulticast });
    const delivered = new Set(['already-rang']);

    await expect(
      (service as any).sendFcm(call, 'incoming', { userType: 'employee', userIds: ['employee-1'] }, delivered),
    ).resolves.toBeUndefined();

    expect(sendEachForMulticast).toHaveBeenCalledWith(expect.objectContaining({ tokens: ['good', 'dead'] }));
    expect(delivered).toEqual(new Set(['already-rang', 'good']));
    expect(devicesRepository.save).toHaveBeenCalledWith([expect.objectContaining({ token: 'dead', isActive: false })]);
  });

  it('retries only when FCM reports a transient error', async () => {
    devicesRepository.find.mockResolvedValueOnce([{ token: 'good' }, { token: 'flaky' }]);
    jest.spyOn(service as any, 'getMessagingClient').mockReturnValue({
      sendEachForMulticast: jest.fn().mockResolvedValue({
        successCount: 1,
        failureCount: 1,
        responses: [{ success: true }, { success: false, error: { code: 'messaging/internal-error', message: 'boom' } }],
      }),
    });
    const delivered = new Set<string>();

    await expect(
      (service as any).sendFcm(call, 'incoming', { userType: 'employee', userIds: ['employee-1'] }, delivered),
    ).rejects.toThrow('transitorio');
    expect(delivered).toEqual(new Set(['good']));
  });
});
