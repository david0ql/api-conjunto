/**
 * Brute-force simulation of the call push outbox.
 *
 * Every scenario is generated from a seed: random residents/employees with
 * random devices (healthy, dead, flaky or unreachable tokens on FCM, HMS and
 * APNs VoIP), one to three calls in any direction, and answers, rejections,
 * hang-ups and timeouts at random moments — including in the middle of a
 * push request. Several API instances race over the same outbox and some
 * scenarios crash an instance right after a provider accepted a push.
 *
 * FUZZ_RUNS=20000 npx jest calls-push.fuzz  → more scenarios.
 * FUZZ_SEED=1234 npx jest calls-push.fuzz   → replay one failing scenario.
 */
import type { CallsPushService } from './calls-push.service';
import type { CallSessionPayload } from './calls.types';
import type { CallPushEvent } from './entities/call-push-job.entity';
import {
  MemoryOutbox,
  PushWorld,
  checkInvariants,
  createRng,
  pick,
  randInt,
  settle,
  silenceLogger,
  type Rng,
  type TokenBehavior,
} from './calls-push.simulator.testspec';

const RUNS = Number(process.env.FUZZ_RUNS ?? 2_500);
const START = Date.UTC(2026, 8, 16, 19, 0, 0);
const RING_MS = 45_000;

interface ScenarioResult {
  violations: string[];
  incomingDeliveries: number;
  lateIncomingBlocked: number;
  crashes: number;
}

type Transition =
  | { kind: 'accept'; at: number }
  | { kind: 'reject'; at: number }
  | { kind: 'cancel'; at: number }
  | { kind: 'none' };

interface PlannedCall {
  call: CallSessionPayload;
  startAt: number;
  started: boolean;
  first: Transition;
  endAfterAcceptMs: number;
  acceptedAt: number | null;
  /** The gateway timeout/reaper (every 10s) can mark a call missed late. */
  timeoutLagMs: number;
}

function behavior(r: Rng): TokenBehavior {
  const roll = r();
  if (roll < 0.45) return 'ok';
  if (roll < 0.75) return 'dead';
  if (roll < 0.95) return 'flaky';
  return 'down';
}

function buildPopulation(r: Rng, world: PushWorld, outbox: MemoryOutbox) {
  const residents = Array.from({ length: randInt(r, 1, 5) }, (_, i) => `resident-${i}`);
  const employees = Array.from({ length: randInt(r, 2, 4) }, (_, i) => `employee-${i}`);
  let tokenSeq = 0;
  const addDevices = (userId: string, userType: 'resident' | 'employee') => {
    // Up to 12 registrations per user, like the porter account in production.
    const count = r() < 0.15 ? randInt(r, 6, 12) : randInt(r, 0, 4);
    for (let i = 0; i < count; i += 1) {
      const kind = pick(r, userType === 'resident'
        ? (['android-fcm', 'ios-fcm', 'android-hms', 'ios-voip'] as const)
        : (['android-fcm', 'ios-fcm', 'android-hms'] as const));
      const [platform, channel] = kind.split('-') as ['android' | 'ios', 'fcm' | 'hms' | 'voip'];
      const token = `${channel}-${userId}-${++tokenSeq}`;
      world.behaviors.set(token, behavior(r));
      outbox.addDevice({ userId, userType, platform, channel, token, deviceId: `phone-${userId}-${i}` });
    }
  };
  residents.forEach((id) => addDevices(id, 'resident'));
  employees.forEach((id) => addDevices(id, 'employee'));
  return { residents, employees };
}

function planCall(r: Rng, index: number, people: { residents: string[]; employees: string[] }): PlannedCall {
  const direction = pick(r, ['outbound', 'inbound', 'internal'] as const);
  const startAt = START + (index === 0 ? 0 : randInt(r, 0, 90_000));
  const employee = pick(r, people.employees);
  const otherEmployee = people.employees.find((id) => id !== employee) ?? employee;
  const residents = people.residents.filter(() => r() < 0.6);
  const call: CallSessionPayload = {
    id: `call-${index}`,
    status: 'ringing',
    direction,
    apartmentId: direction === 'outbound' ? 'apt-710' : null,
    apartment: null,
    initiatedByEmployeeId: direction === 'inbound' ? null : employee,
    initiatedByEmployee: null,
    initiatedByResidentId: direction === 'inbound' ? pick(r, people.residents) : null,
    initiatedByResident: null,
    acceptedByResidentId: null,
    acceptedByResident: null,
    acceptedByEmployeeId: null,
    acceptedByEmployee: null,
    targetResidentIds: direction === 'outbound' ? (residents.length ? residents : [people.residents[0]]) : [],
    targetEmployeeIds: direction === 'outbound' ? [] : [direction === 'inbound' ? employee : otherEmployee],
    rejectedResidentIds: [],
    rejectedEmployeeIds: [],
    endedByUserId: null,
    endedByUserType: null,
    endedReason: null,
    createdAt: new Date(startAt).toISOString(),
    acceptedAt: null,
    endedAt: null,
    expiresAt: new Date(startAt + RING_MS).toISOString(),
  };
  const roll = r();
  // Many transitions land in the first seconds, when retries used to fire.
  const at = startAt + (r() < 0.5 ? randInt(r, 0, 6_000) : randInt(r, 0, RING_MS + 5_000));
  const first: Transition =
    roll < 0.45 ? { kind: 'accept', at } : roll < 0.65 ? { kind: 'reject', at } : roll < 0.8 ? { kind: 'cancel', at } : { kind: 'none' };
  return { call, startAt, started: false, first, endAfterAcceptMs: randInt(r, 0, 120_000), acceptedAt: null, timeoutLagMs: r() < 0.5 ? 0 : randInt(r, 0, 15_000) };
}

async function runScenario(seed: number): Promise<ScenarioResult> {
  const r = createRng(seed);
  jest.setSystemTime(START);
  const world = new PushWorld(r);
  global.fetch = world.fetch as never;
  world.flakyFailureRate = 0.2 + r() * 0.6;
  world.globalFailureRate = r() < 0.3 ? r() * 0.15 : 0;
  const outbox = new MemoryOutbox(r);
  const people = buildPopulation(r, world, outbox);

  const willCrash = r() < 0.15;
  const instances: CallsPushService[] = Array.from({ length: willCrash ? randInt(r, 2, 4) : randInt(r, 1, 4) }, () =>
    outbox.createService(world),
  );
  const internals = (service: CallsPushService) => service as unknown as {
    processPendingJobs: () => Promise<void>;
    recoverAbandonedJobs: () => Promise<void>;
  };

  const plans = Array.from({ length: randInt(r, 1, 3) }, (_, i) => planCall(r, i, people));
  let lateIncomingBlocked = 0;

  const emit = (plan: PlannedCall, event: Exclude<CallPushEvent, 'incoming'>) =>
    void pick(r, instances).sendCallState({ ...plan.call }, event);

  // Mirrors CallsGateway: which push each transition enqueues.
  const applyTransition = (plan: PlannedCall, now: number) => {
    const { call } = plan;
    if (call.status === 'ringing' && now >= plan.startAt + RING_MS + plan.timeoutLagMs) {
      call.status = 'missed';
      call.endedReason = 'timeout';
      emit(plan, 'missed');
      return;
    }
    const first = plan.first;
    if (call.status === 'ringing' && first.kind !== 'none' && now >= first.at) {
      if (first.kind === 'accept') {
        call.status = 'active';
        plan.acceptedAt = now;
        if (call.direction === 'outbound') {
          call.acceptedByResidentId = call.targetResidentIds[0];
          emit(plan, 'accepted');
        } else {
          call.acceptedByEmployeeId = call.targetEmployeeIds[0];
        }
      } else if (first.kind === 'reject') {
        call.status = 'rejected';
        emit(plan, 'rejected');
      } else {
        call.status = 'ended';
        call.endedReason = 'cancelled';
        emit(plan, 'ended');
      }
      return;
    }
    if (call.status === 'active' && plan.acceptedAt !== null && now >= plan.acceptedAt + plan.endAfterAcceptMs) {
      call.status = 'ended';
      call.endedReason = 'completed';
      emit(plan, 'ended');
    }
  };

  // A transition may happen while a provider request is in flight.
  world.onSend = () => {
    if (r() < 0.25) {
      const plan = pick(r, plans);
      if (plan.started) applyTransition(plan, Math.max(Date.now(), plan.first.kind === 'none' ? 0 : plan.first.at));
    }
    if (willCrash && world.crashes === 0 && r() < 0.2) world.crashAfterNextDelivery = true;
  };

  // Worker stall (API restart, blocked event loop, slow database).
  const stallFrom = START + randInt(r, 0, 60_000);
  const stallUntil = r() < 0.35 ? stallFrom + randInt(r, 5_000, 90_000) : stallFrom;

  const acks: Array<{ callId: string; userId: string; at: number }> = [];
  const socketUsers = new Map<string, { online: string[]; createdAt: number }>();

  const endAt = START + 12 * 60_000;
  let lastRecovery = START;
  while (Date.now() < endAt) {
    const now = Date.now();
    for (const ack of acks) {
      if (ack.at <= now) {
        const users = world.showing.get(ack.callId) ?? new Set<string>();
        users.add(ack.userId);
        world.showing.set(ack.callId, users);
      }
    }
    for (const plan of plans) {
      if (!plan.started && now >= plan.startAt) {
        plan.started = true;
        world.calls.set(plan.call.id, plan.call);
        // Gateway: create the call, then enqueue the invitation. Some callees
        // are online on a socket and their app may confirm it shows the call.
        const targets = plan.call.direction === 'outbound' ? plan.call.targetResidentIds : plan.call.targetEmployeeIds;
        const online = targets.filter(() => r() < 0.5);
        for (const userId of online) {
          if (r() < 0.6) {
            const confirmAt = now + randInt(r, 50, 4_000);
            acks.push({ callId: plan.call.id, userId, at: confirmAt });
          }
        }
        socketUsers.set(plan.call.id, { online, createdAt: now });
        void pick(r, instances).sendIncomingCall({ ...plan.call }, { socketUserIds: online });
      }
      if (plan.started) applyTransition(plan, now);
    }
    if (now - lastRecovery >= 30_000) {
      lastRecovery = now;
      void internals(pick(r, instances)).recoverAbandonedJobs();
    }
    if (now < stallFrom || now >= stallUntil) {
      instances.forEach((service) => void internals(service).processPendingJobs());
    }
    await settle(6);

    const busy = outbox.jobs.some((job) => job.status === 'pending' || job.status === 'processing');
    const allStarted = plans.every((plan) => plan.started);
    const allClosed = plans.every((plan) => !['ringing', 'active'].includes(plan.call.status));
    if (allStarted && allClosed && !busy) break;
    jest.setSystemTime(now + randInt(r, 50, 3_000));
  }
  await settle();

  for (const plan of plans) {
    lateIncomingBlocked += outbox.jobs.filter(
      (job) => job.callSessionId === plan.call.id && job.event === 'incoming' && /ya no está timbrando/.test(job.lastError ?? ''),
    ).length;
  }

  // Online callees: never pushed inside the confirmation window, and never
  // pushed at all once their app confirmed before the window closed.
  const extra: string[] = [];
  const userOfToken = new Map(outbox.devices.map((device) => [device.token, device.userId]));
  for (const delivery of world.deliveries.filter((item) => item.event === 'incoming')) {
    const info = socketUsers.get(delivery.callId);
    const userId = userOfToken.get(delivery.token);
    if (!info || !userId || !info.online.includes(userId)) continue;
    if (delivery.at < info.createdAt + 2_500) extra.push(`online ${userId} pushed ${delivery.at - info.createdAt}ms after creation`);
    const ack = acks.find((item) => item.callId === delivery.callId && item.userId === userId);
    if (ack && ack.at < delivery.at && ack.at <= info.createdAt + 2_500) {
      extra.push(`${userId} confirmed at +${ack.at - info.createdAt}ms but was pushed at +${delivery.at - info.createdAt}ms`);
    }
  }

  const violations = [...extra, ...checkInvariants({
    world,
    jobs: outbox.jobs,
    devices: outbox.devices,
    instances: instances.length,
    allowStateDuplicates: world.crashes > 0,
  })];
  return {
    violations,
    incomingDeliveries: world.deliveries.filter((delivery) => delivery.event === 'incoming').length,
    lateIncomingBlocked,
    crashes: world.crashes,
  };
}

describe('CallsPushService brute-force simulation', () => {
  beforeAll(() => {
    silenceLogger();
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
  });

  afterAll(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it(`keeps every invariant across ${process.env.FUZZ_SEED ? 1 : RUNS} random scenarios`, async () => {
    const originalFetch = global.fetch;
    const seeds = process.env.FUZZ_SEED ? [Number(process.env.FUZZ_SEED)] : Array.from({ length: RUNS }, (_, i) => 0x5eed + i * 7919);
    const failures: string[] = [];
    const totals = { incomingDeliveries: 0, lateIncomingBlocked: 0, crashes: 0 };

    try {
      for (const seed of seeds) {
        const result = await runScenario(seed);
        totals.incomingDeliveries += result.incomingDeliveries;
        totals.lateIncomingBlocked += result.lateIncomingBlocked;
        totals.crashes += result.crashes;
        if (result.violations.length > 0) {
          failures.push(`seed ${seed}:\n  - ${result.violations.slice(0, 8).join('\n  - ')}`);
          if (failures.length >= 5) break;
        }
      }
    } finally {
      global.fetch = originalFetch;
    }

    // The simulation must actually exercise the dangerous paths.
    if (!process.env.FUZZ_SEED) {
      expect(totals.incomingDeliveries).toBeGreaterThan(RUNS);
      expect(totals.lateIncomingBlocked).toBeGreaterThan(RUNS / 20);
      expect(totals.crashes).toBeGreaterThan(0);
    }
    expect(failures).toEqual([]);
  }, 600_000);
});
