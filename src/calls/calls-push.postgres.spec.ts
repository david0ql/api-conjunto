/**
 * Integration tests of the push outbox against a real PostgreSQL: the
 * `FOR UPDATE SKIP LOCKED` claim, the unique (call, event, channel) index, the
 * `delivered_tokens` column round trip and several API replicas racing.
 *
 * Skipped unless CALLS_PG_URL points to a disposable database, e.g.
 *   CALLS_PG_URL=postgres://postgres@localhost:55432/calls_push_test npx jest calls-push.postgres
 * The schema of that database is dropped and recreated.
 */
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { CallsPushService } from './calls-push.service';
import type { CallSessionPayload } from './calls.types';
import { CallDevice } from './entities/call-device.entity';
import { CallPushJob, type CallPushEvent } from './entities/call-push-job.entity';
import {
  PushWorld,
  checkInvariants,
  createRng,
  pick,
  randInt,
  silenceLogger,
  type Rng,
  type TokenBehavior,
} from './calls-push.simulator.testspec';

const PG_URL = process.env.CALLS_PG_URL;
const RUNS = Number(process.env.PG_FUZZ_RUNS ?? 120);
const REPLICAS = 4;

const describePg = PG_URL ? describe : describe.skip;

type Internals = {
  processPendingJobs: () => Promise<void>;
  recoverAbandonedJobs: () => Promise<void>;
  claimJobs: (limit: number) => Promise<CallPushJob[]>;
};
const internals = (service: CallsPushService) => service as unknown as Internals;

function makeCall(r: Rng, residents: string[], employees: string[]): CallSessionPayload {
  const direction = pick(r, ['outbound', 'inbound', 'internal'] as const);
  const now = Date.now();
  return {
    id: randomUUID(),
    status: 'ringing',
    direction,
    apartmentId: null,
    apartment: null,
    initiatedByEmployeeId: direction === 'inbound' ? null : employees[1],
    initiatedByEmployee: null,
    initiatedByResidentId: direction === 'inbound' ? residents[0] : null,
    initiatedByResident: null,
    acceptedByResidentId: null,
    acceptedByResident: null,
    acceptedByEmployeeId: null,
    acceptedByEmployee: null,
    targetResidentIds: direction === 'outbound' ? residents.filter((_, i) => i === 0 || r() < 0.5) : [],
    targetEmployeeIds: direction === 'outbound' ? [] : [employees[0]],
    rejectedResidentIds: [],
    rejectedEmployeeIds: [],
    endedByUserId: null,
    endedByUserType: null,
    endedReason: null,
    createdAt: new Date(now).toISOString(),
    acceptedAt: null,
    endedAt: null,
    expiresAt: new Date(now + 45_000).toISOString(),
  };
}

describePg('CallsPushService on PostgreSQL', () => {
  const sources: DataSource[] = [];
  let world: PushWorld;
  let services: CallsPushService[];
  const originalFetch = global.fetch;

  const devicesRepo = () => sources[0].getRepository(CallDevice);
  const jobsRepo = () => sources[0].getRepository(CallPushJob);

  beforeAll(async () => {
    silenceLogger();
    for (let i = 0; i < REPLICAS; i += 1) {
      const source = new DataSource({
        type: 'postgres',
        url: PG_URL,
        entities: [CallDevice, CallPushJob],
        synchronize: i === 0,
        dropSchema: i === 0,
        poolSize: 5,
        logging: false,
      });
      await source.initialize();
      sources.push(source);
    }
  }, 60_000);

  afterAll(async () => {
    global.fetch = originalFetch;
    await Promise.all(sources.map((source) => source.destroy()));
  });

  beforeEach(async () => {
    await sources[0].query('TRUNCATE call_push_jobs, call_devices');
    world = new PushWorld(createRng(42));
    global.fetch = world.fetch as never;
    services = sources.map((source) =>
      world.wire(
        new CallsPushService(
          source.getRepository(CallDevice),
          source.getRepository(CallPushJob),
          source,
          world.configService as never,
          world.callsService as never,
        ),
      ),
    );
  });

  const addDevice = async (userId: string, userType: 'resident' | 'employee', token: string, behavior: TokenBehavior, channel: 'fcm' | 'hms' | 'voip' = 'fcm') => {
    world.behaviors.set(token, behavior);
    return devicesRepo().save(
      devicesRepo().create({
        userId,
        userType,
        token,
        channel,
        platform: channel === 'voip' ? 'ios' : 'android',
        pushEnvironment: 'production',
        deviceId: `phone-${token}`,
        isActive: true,
      }),
    );
  };

  /** Skips the exponential backoff so retries happen in the next round. */
  const fastForward = () => sources[0].query(`UPDATE call_push_jobs SET next_attempt_at = NOW() WHERE status = 'pending'`);

  /** Waits for in-flight jobs (e.g. the worker kicked off by enqueue) to settle. */
  const waitIdle = async () => {
    for (let i = 0; i < 200; i += 1) {
      const [{ busy }] = await sources[0].query(`SELECT COUNT(*)::int AS busy FROM call_push_jobs WHERE status = 'processing'`);
      if (busy === 0) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('jobs stuck in processing');
  };

  const drain = async (rounds = 12) => {
    for (let i = 0; i < rounds; i += 1) {
      await waitIdle();
      await Promise.all(services.map((service) => internals(service).processPendingJobs()));
      await waitIdle();
      await fastForward();
    }
  };

  it('creates one job per channel when replicas enqueue the same invitation concurrently', async () => {
    const employee = randomUUID();
    await addDevice(employee, 'employee', 'phone', 'ok');
    const call = makeCall(createRng(1), [randomUUID()], [employee, randomUUID()]);
    call.direction = 'inbound';
    call.targetEmployeeIds = [employee];
    world.calls.set(call.id, call);

    await Promise.all(
      services.flatMap((service) => Array.from({ length: 25 }, () => service.sendIncomingCall({ ...call }))),
    );
    await drain();

    const jobs = await jobsRepo().find({ where: { callSessionId: call.id } });
    expect(jobs.map((job) => job.channel).sort()).toEqual(['fcm', 'hms']);
    expect(world.deliveries.filter((delivery) => delivery.token === 'phone')).toHaveLength(1);
  });

  it('never hands the same job to two replicas (SKIP LOCKED)', async () => {
    const payload = makeCall(createRng(2), [randomUUID()], [randomUUID(), randomUUID()]);
    const rows = Array.from({ length: 400 }, () => ({
      callSessionId: randomUUID(),
      event: 'ended' as CallPushEvent,
      channel: 'fcm' as const,
      payload,
      status: 'pending' as const,
      attempts: 0,
      nextAttemptAt: new Date(Date.now() - 1_000),
    }));
    await jobsRepo().insert(rows as never);

    const claimed: string[] = [];
    await Promise.all(
      Array.from({ length: 16 }, async (_, i) => {
        const service = services[i % REPLICAS];
        for (;;) {
          const jobs = await internals(service).claimJobs(7);
          if (jobs.length === 0) return;
          claimed.push(...jobs.map((job) => job.id));
        }
      }),
    );

    expect(claimed).toHaveLength(400);
    expect(new Set(claimed).size).toBe(400);
    const [{ max }] = await sources[0].query('SELECT MAX(attempts) AS max FROM call_push_jobs');
    expect(Number(max)).toBe(1);
  });

  it('persists delivered tokens so a retry only targets the failed one', async () => {
    const employee = randomUUID();
    await addDevice(employee, 'employee', 'healthy', 'ok');
    await addDevice(employee, 'employee', 'flaky', 'flaky');
    world.flakyFailureRate = 1;
    const call = makeCall(createRng(3), [randomUUID()], [employee, randomUUID()]);
    call.direction = 'inbound';
    call.targetEmployeeIds = [employee];
    world.calls.set(call.id, call);

    await services[0].sendIncomingCall({ ...call });
    await waitIdle();
    await Promise.all(services.map((service) => internals(service).processPendingJobs()));
    await waitIdle();
    const [afterFailure] = await sources[0].query(
      `SELECT status, attempts, delivered_tokens FROM call_push_jobs WHERE call_session_id = $1 AND channel = 'fcm'`,
      [call.id],
    );
    expect(afterFailure).toMatchObject({ status: 'pending', attempts: 1 });
    expect(JSON.parse(afterFailure.delivered_tokens)).toEqual(['healthy']);

    world.flakyFailureRate = 0;
    await drain(2);
    expect(world.deliveries.filter((delivery) => delivery.token === 'healthy')).toHaveLength(1);
    expect(world.deliveries.filter((delivery) => delivery.token === 'flaky')).toHaveLength(1);
    expect(await jobsRepo().findOneBy({ callSessionId: call.id, channel: 'fcm' })).toMatchObject({ status: 'sent', attempts: 2 });
  });

  it('recovers jobs abandoned for more than two minutes', async () => {
    const payload = makeCall(createRng(4), [randomUUID()], [randomUUID(), randomUUID()]);
    await jobsRepo().insert([
      { callSessionId: randomUUID(), event: 'ended', channel: 'fcm', payload, status: 'processing', attempts: 1, lockedAt: new Date(Date.now() - 3 * 60_000) },
      { callSessionId: randomUUID(), event: 'ended', channel: 'fcm', payload, status: 'processing', attempts: 1, lockedAt: new Date(Date.now() - 30_000) },
    ] as never);

    await internals(services[1]).recoverAbandonedJobs();

    const statuses = (await jobsRepo().find({ order: { lockedAt: 'ASC' } })).map((job) => job.status);
    expect(statuses.sort()).toEqual(['pending', 'processing']);
  });

  it('deactivates replaced tokens of the same phone and channel', async () => {
    const employee = randomUUID();
    await devicesRepo().save([
      devicesRepo().create({ userId: employee, userType: 'employee', token: 'old', channel: 'fcm', platform: 'android', deviceId: 'phone-A', isActive: true }),
      devicesRepo().create({ userId: employee, userType: 'employee', token: 'voip', channel: 'voip', platform: 'ios', deviceId: 'phone-A', isActive: true }),
      devicesRepo().create({ userId: employee, userType: 'employee', token: 'other', channel: 'fcm', platform: 'android', deviceId: 'phone-B', isActive: true }),
    ]);

    await services[2].registerDevice({ sub: employee, type: 'employee' } as never, {
      token: 'new', platform: 'android', channel: 'fcm', deviceId: 'phone-A',
    });

    const active = Object.fromEntries((await devicesRepo().find()).map((device) => [device.token, device.isActive]));
    expect(active).toEqual({ old: false, voip: true, other: true, new: true });
  });

  it(`keeps every invariant across ${RUNS} random scenarios with ${REPLICAS} replicas`, async () => {
    const failures: string[] = [];
    let incoming = 0;

    for (let run = 0; run < RUNS && failures.length < 5; run += 1) {
      const seed = 0xbeef + run * 104_729;
      const r = createRng(seed);
      await sources[0].query('TRUNCATE call_push_jobs, call_devices');
      world = new PushWorld(r);
      world.flakyFailureRate = 0.2 + r() * 0.6;
      world.globalFailureRate = r() < 0.3 ? r() * 0.2 : 0;
      global.fetch = world.fetch as never;
      services = sources.map((source) =>
        world.wire(
          new CallsPushService(
            source.getRepository(CallDevice),
            source.getRepository(CallPushJob),
            source,
            world.configService as never,
            world.callsService as never,
          ),
        ),
      );

      const residents = Array.from({ length: randInt(r, 1, 4) }, () => randomUUID());
      const employees = [randomUUID(), randomUUID()];
      let tokenSeq = 0;
      for (const [userId, userType] of [...residents.map((id) => [id, 'resident'] as const), ...employees.map((id) => [id, 'employee'] as const)]) {
        for (let i = 0; i < randInt(r, 0, 10); i += 1) {
          const channel = pick(r, userType === 'resident' ? (['fcm', 'hms', 'voip'] as const) : (['fcm', 'hms'] as const));
          const roll = r();
          const behavior: TokenBehavior = roll < 0.45 ? 'ok' : roll < 0.75 ? 'dead' : roll < 0.95 ? 'flaky' : 'down';
          await addDevice(userId, userType, `${channel}-${run}-${++tokenSeq}`, behavior, channel);
        }
      }

      const calls = Array.from({ length: randInt(r, 1, 3) }, () => makeCall(r, residents, employees));
      const stopRound = calls.map(() => randInt(r, 0, 8));
      const outcome = calls.map(() => pick(r, ['accept', 'reject', 'cancel', 'timeout'] as const));
      calls.forEach((call) => world.calls.set(call.id, call));
      await Promise.all(calls.map((call) => pick(r, services).sendIncomingCall({ ...call })));

      world.onSend = () => {
        if (r() < 0.2) {
          const index = randInt(r, 0, calls.length - 1);
          stopRound[index] = -1;
        }
      };

      for (let round = 0; round < 20; round += 1) {
        const stateEvents: Array<Promise<void>> = [];
        calls.forEach((call, index) => {
          if (call.status !== 'ringing' || (stopRound[index] > round && stopRound[index] !== -1)) return;
          const service = pick(r, services);
          const kind = outcome[index];
          if (kind === 'accept') {
            call.status = 'active';
            if (call.direction === 'outbound') stateEvents.push(service.sendCallState({ ...call }, 'accepted'));
          } else if (kind === 'reject') {
            call.status = 'rejected';
            stateEvents.push(service.sendCallState({ ...call }, 'rejected'));
          } else if (kind === 'cancel') {
            call.status = 'ended';
            stateEvents.push(service.sendCallState({ ...call }, 'ended'));
          } else {
            call.status = 'missed';
            stateEvents.push(service.sendCallState({ ...call }, 'missed'));
          }
        });
        calls.forEach((call) => {
          if (call.status === 'active' && r() < 0.3) {
            call.status = 'ended';
            stateEvents.push(pick(r, services).sendCallState({ ...call }, 'ended'));
          }
        });
        await Promise.all([...stateEvents, ...services.map((service) => internals(service).processPendingJobs())]);
        await waitIdle();
        await fastForward();
      }
      calls.filter((call) => call.status === 'active').forEach((call) => (call.status = 'ended'));
      world.onSend = null;
      await drain(8);
      await waitIdle();

      const [jobs, devices] = await Promise.all([jobsRepo().find(), devicesRepo().find()]);
      incoming += world.deliveries.filter((delivery) => delivery.event === 'incoming').length;
      const violations = checkInvariants({ world, jobs, devices, instances: REPLICAS, allowStateDuplicates: false });
      if (violations.length > 0) failures.push(`seed ${seed}:\n  - ${violations.slice(0, 8).join('\n  - ')}`);
    }

    expect(incoming).toBeGreaterThan(RUNS);
    expect(failures).toEqual([]);
  }, 900_000);
});
