/**
 * Test-only harness for the call push outbox. Excluded from the build by the
 * `**\/*spec.ts` pattern and not picked up by Jest as a suite (no `.spec.ts`).
 *
 * It models the push providers (FCM, HMS, APNs VoIP) as recording transports
 * with per-token behaviour, so invariant checks can prove that no device ever
 * rings twice for the same call or rings after the call stopped ringing.
 */
import { Logger } from '@nestjs/common';
import { CallsPushService } from './calls-push.service';
import type { CallSessionPayload } from './calls.types';
import type { CallDevice } from './entities/call-device.entity';
import type {
  CallPushChannel,
  CallPushEvent,
  CallPushJob,
} from './entities/call-push-job.entity';
import type { CallSessionStatus } from './entities/call-session.entity';

export type Rng = () => number;

export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pick = <T>(r: Rng, items: readonly T[]): T =>
  items[Math.floor(r() * items.length)];

export const randInt = (r: Rng, min: number, max: number) =>
  min + Math.floor(r() * (max - min + 1));

/** ok = always delivers, dead = permanently invalid token, flaky = random transient errors, down = always transient. */
export type TokenBehavior = 'ok' | 'dead' | 'flaky' | 'down';

export interface DeliveryRecord {
  callId: string;
  token: string;
  channel: CallPushChannel;
  event: CallPushEvent;
  at: number;
  statusAtSend: CallSessionStatus | null;
  expiresAt: number | null;
  ttlMs: number | null;
  collapseKey: string | null;
}

export interface AttemptRecord {
  callId: string;
  token: string;
  channel: CallPushChannel;
  event: CallPushEvent;
  at: number;
  outcome: 'delivered' | 'dead' | 'transient';
  /** The process died before it could read the provider's answer. */
  crashed?: boolean;
}

const FCM_DEAD_ERRORS = [
  { code: 'messaging/registration-token-not-registered', message: 'NotRegistered' },
  { code: 'messaging/registration-token-not-registered', message: 'Requested entity was not found.' },
  { code: 'messaging/invalid-registration-token', message: 'Invalid registration token provided.' },
  { code: 'messaging/invalid-argument', message: 'Requested entity was not found.' },
  { code: 'messaging/mismatched-credential', message: 'SenderId mismatch' },
];
const FCM_TRANSIENT_ERRORS = [
  { code: 'messaging/internal-error', message: 'Internal error' },
  { code: 'messaging/server-unavailable', message: 'Unavailable' },
  { code: 'messaging/unknown-error', message: 'socket hang up' },
  { code: 'messaging/quota-exceeded', message: 'Quota exceeded' },
];
const APNS_DEAD_REASONS = ['BadDeviceToken', 'Unregistered', 'DeviceTokenNotForTopic'];

/**
 * Shared "outside world": call state as the database sees it plus the push
 * providers. Everything a transport sends is recorded for the invariants.
 */
export class PushWorld {
  readonly calls = new Map<string, CallSessionPayload>();
  readonly behaviors = new Map<string, TokenBehavior>();
  readonly deliveries: DeliveryRecord[] = [];
  readonly attempts: AttemptRecord[] = [];
  readonly globalFailures = new Map<string, number>();
  flakyFailureRate = 0.5;
  globalFailureRate = 0;
  /** Runs when a request starts, after its state was recorded: models races. */
  onSend: (() => void) | null = null;
  /** When set, the next transport call delivers and then never resolves (process crash). */
  crashAfterNextDelivery = false;
  crashes = 0;
  /** Receives every accepted push with its raw data (to route it to a simulated phone). */
  onDelivery: ((token: string, channel: CallPushChannel, data: Record<string, unknown>) => void) | null = null;

  constructor(private readonly r: Rng) {}

  readonly callsService = {
    recordTrace: async () => undefined,
    getCallStatus: async (callId: string) => this.calls.get(callId)?.status ?? null,
    getUsersShowingIncomingCall: async (callId: string, userIds: string[]) =>
      new Set(userIds.filter((id) => this.showing.get(callId)?.has(id))),
  };
  /** callId → users whose app confirmed it shows the invitation. */
  readonly showing = new Map<string, Set<string>>();

  readonly configService = {
    get: (key: string, fallback?: string) =>
      ({
        HMS_CLIENT_ID: 'hms-client',
        HMS_CLIENT_SECRET: 'hms-secret',
        HMS_APP_ID: 'hms-app',
      })[key] ?? fallback,
  };

  readonly messaging = {
    sendEachForMulticast: async (message: {
      tokens: string[];
      data: Record<string, string>;
      android?: { ttl?: number; collapseKey?: string };
    }) => {
      const callId = message.data.callId;
      const event = message.data.event as CallPushEvent;
      const firstAttempt = this.attempts.length;
      const statusAtSend = this.calls.get(callId)?.status ?? null;
      this.onSend?.();
      if (this.r() < this.globalFailureRate) {
        this.bumpGlobalFailure(callId, event, 'fcm');
        throw new Error('FCM request failed: ECONNRESET');
      }
      const responses = message.tokens.map((token) => {
        const outcome = this.outcomeFor(token);
        this.recordAttempt(callId, token, 'fcm', event, outcome);
        if (outcome === 'delivered') {
          this.recordDelivery(callId, token, 'fcm', event, statusAtSend, message.android?.ttl ?? null, message.android?.collapseKey ?? null, message.data);
          return { success: true };
        }
        const error = outcome === 'dead' ? pick(this.r, FCM_DEAD_ERRORS) : pick(this.r, FCM_TRANSIENT_ERRORS);
        return { success: false, error };
      });
      const successCount = responses.filter((response) => response.success).length;
      await this.maybeCrash(firstAttempt);
      return { successCount, failureCount: responses.length - successCount, responses };
    },
  };

  readonly apnProvider = {
    send: async (
      note: { payload: Record<string, unknown>; expiry: number; collapseId?: string },
      tokens: string[],
    ) => {
      const callId = String(note.payload.callId);
      const firstAttempt = this.attempts.length;
      const statusAtSend = this.calls.get(callId)?.status ?? null;
      this.onSend?.();
      if (this.r() < this.globalFailureRate) {
        this.bumpGlobalFailure(callId, 'incoming', 'voip');
        throw new Error('APNs connection closed');
      }
      const sent: Array<{ device: string }> = [];
      const failed: Array<{ device: string; status?: string; response?: { reason?: string } }> = [];
      const ttlMs = note.expiry * 1000 - Date.now();
      for (const token of tokens) {
        const outcome = this.outcomeFor(token);
        this.recordAttempt(callId, token, 'voip', 'incoming', outcome);
        if (outcome === 'delivered') {
          this.recordDelivery(callId, token, 'voip', 'incoming', statusAtSend, ttlMs, note.collapseId ?? null, note.payload);
          sent.push({ device: token });
        } else if (outcome === 'dead') {
          failed.push({ device: token, status: '410', response: { reason: pick(this.r, APNS_DEAD_REASONS) } });
        } else {
          failed.push(this.r() < 0.5 ? { device: token, status: '500', response: { reason: 'InternalServerError' } } : { device: token });
        }
      }
      await this.maybeCrash(firstAttempt);
      return { sent, failed };
    },
  };

  readonly fetch = async (url: string, init: { body: unknown }) => {
    if (url.includes('oauth2')) {
      return { ok: true, status: 200, json: async () => ({ access_token: 'hms-token' }) };
    }
    const body = JSON.parse(String(init.body)) as {
      message: { token: string[]; data: string; android: { ttl: string } };
    };
    const data = JSON.parse(body.message.data) as { callId: string; event: CallPushEvent } & Record<string, unknown>;
    const firstAttempt = this.attempts.length;
    const statusAtSend = this.calls.get(data.callId)?.status ?? null;
    this.onSend?.();
    const outcomes = body.message.token.map((token) => [token, this.outcomeFor(token)] as const);
    // HMS answers one request for the whole batch: any transient problem
    // fails the request and nobody receives the message.
    if (this.r() < this.globalFailureRate || outcomes.some(([, outcome]) => outcome === 'transient')) {
      outcomes.forEach(([token]) => this.recordAttempt(data.callId, token, 'hms', data.event, 'transient'));
      this.bumpGlobalFailure(data.callId, data.event, 'hms');
      return { ok: false, status: 503, json: async () => ({}) };
    }
    const ttlMs = Number.parseInt(body.message.android.ttl, 10) * 1000;
    const illegal: string[] = [];
    for (const [token, outcome] of outcomes) {
      this.recordAttempt(data.callId, token, 'hms', data.event, outcome);
      if (outcome === 'delivered') {
        this.recordDelivery(data.callId, token, 'hms', data.event, statusAtSend, ttlMs, null, data);
      } else {
        illegal.push(token);
      }
    }
    await this.maybeCrash(firstAttempt);
    const json = illegal.length === 0
      ? { code: '80000000', msg: 'Success' }
      : {
          code: '80100000',
          msg: JSON.stringify({ success: outcomes.length - illegal.length, failure: illegal.length, illegal_tokens: illegal }),
        };
    return { ok: true, status: 200, json: async () => json };
  };

  /** Wires a real CallsPushService to this world's providers. */
  wire(service: CallsPushService) {
    const internals = service as unknown as Record<string, unknown>;
    internals.getMessagingClient = () => this.messaging;
    internals.getApnProvider = () => this.apnProvider;
    return service;
  }

  deliveriesFor(callId: string) {
    return this.deliveries.filter((delivery) => delivery.callId === callId);
  }

  private outcomeFor(token: string): AttemptRecord['outcome'] {
    const behavior = this.behaviors.get(token) ?? 'ok';
    if (behavior === 'ok') return 'delivered';
    if (behavior === 'dead') return 'dead';
    if (behavior === 'down') return 'transient';
    return this.r() < this.flakyFailureRate ? 'transient' : 'delivered';
  }

  private recordAttempt(callId: string, token: string, channel: CallPushChannel, event: CallPushEvent, outcome: AttemptRecord['outcome']) {
    this.attempts.push({ callId, token, channel, event, at: Date.now(), outcome });
  }

  private recordDelivery(
    callId: string,
    token: string,
    channel: CallPushChannel,
    event: CallPushEvent,
    statusAtSend: CallSessionStatus | null,
    ttlMs: number | null,
    collapseKey: string | null,
    data: Record<string, unknown> = {},
  ) {
    this.onDelivery?.(token, channel, data);
    const expiresAt = this.calls.get(callId)?.expiresAt;
    this.deliveries.push({
      callId, token, channel, event, at: Date.now(), statusAtSend,
      expiresAt: expiresAt ? new Date(expiresAt).getTime() : null,
      ttlMs, collapseKey,
    });
  }

  private bumpGlobalFailure(callId: string, event: CallPushEvent, channel: CallPushChannel) {
    const key = `${callId}|${event}|${channel}`;
    this.globalFailures.set(key, (this.globalFailures.get(key) ?? 0) + 1);
  }

  private async maybeCrash(firstAttempt: number) {
    if (!this.crashAfterNextDelivery) return;
    this.crashAfterNextDelivery = false;
    this.attempts.slice(firstAttempt).forEach((attempt) => (attempt.crashed = true));
    this.crashes += 1;
    await new Promise<never>(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// In-memory persistence that mimics the SQL the service relies on.
// ---------------------------------------------------------------------------

type FindWhere = Record<string, unknown>;

function matches(row: Record<string, unknown>, where: FindWhere) {
  return Object.entries(where).every(([key, expected]) => {
    const operator = expected as { type?: string; value?: unknown[] } | null;
    if (operator && typeof operator === 'object' && operator.type === 'in') {
      return (operator.value ?? []).includes(row[key]);
    }
    return row[key] === expected;
  });
}

const DEVICE_CONDITIONS: Record<string, (row: CallDevice, params: Record<string, unknown>) => boolean> = {
  'device_id = :deviceId': (row, p) => row.deviceId === p.deviceId,
  'channel = :channel': (row, p) => row.channel === p.channel,
  'token <> :token': (row, p) => row.token !== p.token,
  'is_active = true': (row) => row.isActive,
  'NOT (user_id = :userId AND user_type = :userType)': (row, p) =>
    !(row.userId === p.userId && row.userType === p.userType),
};

const JOB_CONDITIONS: Record<string, (row: CallPushJob) => boolean> = {
  "status = 'processing'": (row) => row.status === 'processing',
  "locked_at < NOW() - INTERVAL '2 minutes'": (row) =>
    Boolean(row.lockedAt && row.lockedAt.getTime() < Date.now() - 120_000),
};

export class MemoryOutbox {
  readonly jobs: CallPushJob[] = [];
  readonly devices: CallDevice[] = [];
  private sequence = 0;

  constructor(private readonly r: Rng) {}

  addDevice(input: Pick<CallDevice, 'userId' | 'userType' | 'platform' | 'channel' | 'token'> & Partial<CallDevice>) {
    const device = {
      id: `device-${++this.sequence}`,
      pushEnvironment: 'production',
      deviceId: null,
      appVersion: null,
      isActive: true,
      lastSeenAt: null,
      lastError: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...input,
    } as CallDevice;
    this.devices.push(device);
    return device;
  }

  readonly devicesRepository = {
    find: async ({ where }: { where: FindWhere }) =>
      this.devices
        .filter((device) => matches(device as never, where))
        .map((device) => ({ ...device })),
    findOne: async ({ where }: { where: FindWhere }) => {
      const found = this.devices.find((device) => matches(device as never, where));
      return found ? { ...found } : null;
    },
    create: () => ({}) as CallDevice,
    save: async (input: CallDevice | CallDevice[]) => {
      for (const entity of Array.isArray(input) ? input : [input]) {
        const stored = entity.id ? this.devices.find((device) => device.id === entity.id) : undefined;
        if (stored) Object.assign(stored, entity);
        else this.devices.push({ ...entity, id: `device-${++this.sequence}` });
      }
      return input;
    },
    createQueryBuilder: () => this.updateBuilder(this.devices as never[], DEVICE_CONDITIONS as never),
  };

  readonly jobsRepository = {
    create: (value: Partial<CallPushJob>) => value as CallPushJob,
    update: async (id: string, patch: Partial<CallPushJob>) => {
      const job = this.jobs.find((item) => item.id === id);
      if (!job) throw new Error(`job ${id} not found`);
      Object.assign(job, patch);
      return { affected: 1 };
    },
    createQueryBuilder: () => this.updateBuilder(this.jobs as never[], JOB_CONDITIONS as never),
  };

  readonly dataSource = {
    transaction: async <T>(callback: (manager: { query: (sql: string, params: unknown[]) => Promise<unknown> }) => Promise<T>) =>
      callback({ query: async (sql, params) => this.claim(sql, Number(params[0])) }),
  };

  createService(world: PushWorld) {
    return world.wire(
      new CallsPushService(
        this.devicesRepository as never,
        this.jobsRepository as never,
        this.dataSource as never,
        world.configService as never,
        world.callsService as never,
      ),
    );
  }

  private claim(sql: string, limit: number) {
    if (!sql.includes('FOR UPDATE SKIP LOCKED')) throw new Error('claim query must lock rows');
    const now = Date.now();
    const due = this.jobs
      .filter((job) => job.status === 'pending' && job.nextAttemptAt.getTime() <= now)
      .sort((a, b) => a.nextAttemptAt.getTime() - b.nextAttemptAt.getTime() || a.createdAt.getTime() - b.createdAt.getTime())
      .slice(0, limit);
    const rows = due.map((job) => {
      job.status = 'processing';
      job.lockedAt = new Date(now);
      job.attempts += 1;
      // Postgres returns simple-json columns as text.
      return {
        id: job.id,
        callSessionId: job.callSessionId,
        event: job.event,
        channel: job.channel,
        payload: JSON.stringify(job.payload),
        deliveredTokens: job.deliveredTokens ? JSON.stringify(job.deliveredTokens) : null,
        deferredUserIds: job.deferredUserIds ? JSON.stringify(job.deferredUserIds) : null,
        createdAt: job.createdAt,
        attempts: job.attempts,
      };
    });
    return this.r() < 0.5 ? rows : [rows, rows.length];
  }

  private updateBuilder(rows: Array<Record<string, unknown>>, conditions: Record<string, (row: never, params: Record<string, unknown>) => boolean>) {
    const state = { values: [] as Array<Record<string, unknown>>, set: {} as Record<string, unknown>, where: [] as Array<[string, Record<string, unknown>]>, ignore: false, op: '' };
    const builder = {
      insert: () => ((state.op = 'insert'), builder),
      into: () => builder,
      values: (values: Array<Record<string, unknown>>) => ((state.values = values), builder),
      orIgnore: () => ((state.ignore = true), builder),
      update: () => ((state.op = 'update'), builder),
      set: (values: Record<string, unknown>) => ((state.set = values), builder),
      where: (sql: string, params: Record<string, unknown> = {}) => (state.where.push([sql, params]), builder),
      andWhere: (sql: string, params: Record<string, unknown> = {}) => (state.where.push([sql, params]), builder),
      execute: async () => {
        if (state.op === 'insert') return this.insertJobs(state.values, state.ignore);
        let affected = 0;
        for (const row of rows) {
          const ok = state.where.every(([sql, params]) => {
            const condition = conditions[sql];
            if (!condition) throw new Error(`Unsupported condition in simulator: ${sql}`);
            return condition(row as never, params);
          });
          if (ok) {
            Object.assign(row, state.set);
            affected += 1;
          }
        }
        return { affected };
      },
    };
    return builder;
  }

  private insertJobs(values: Array<Record<string, unknown>>, ignore: boolean) {
    for (const value of values) {
      const duplicate = this.jobs.some(
        (job) => job.callSessionId === value.callSessionId && job.event === value.event && job.channel === value.channel,
      );
      if (duplicate) {
        if (ignore) continue;
        throw new Error('unique violation');
      }
      this.jobs.push({
        id: `job-${++this.sequence}`,
        deliveredTokens: null,
        deferredUserIds: null,
        lockedAt: null,
        sentAt: null,
        lastError: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...value,
        // simple-json stores a snapshot, never a live reference.
        payload: JSON.parse(JSON.stringify(value.payload)),
      } as CallPushJob);
    }
    return { affected: values.length };
  }
}

// ---------------------------------------------------------------------------
// Invariants
// ---------------------------------------------------------------------------

export interface InvariantInput {
  world: PushWorld;
  jobs: CallPushJob[];
  devices: CallDevice[];
  instances: number;
  /** Crashes make state events at-least-once; invitations must stay exactly-once. */
  allowStateDuplicates: boolean;
}

export function checkInvariants({ world, jobs, devices, instances, allowStateDuplicates }: InvariantInput): string[] {
  const violations: string[] = [];
  const deviceByToken = new Map(devices.map((device) => [device.token, device]));

  const counts = new Map<string, number>();
  for (const delivery of world.deliveries) {
    const call = world.calls.get(delivery.callId);
    const device = deviceByToken.get(delivery.token);
    if (!call || !device) {
      violations.push(`delivery to unknown call/device ${delivery.callId}/${delivery.token}`);
      continue;
    }

    // Only target users of the call may ever receive anything.
    const targets = call.direction === 'outbound' ? call.targetResidentIds : call.targetEmployeeIds;
    const targetType = call.direction === 'outbound' ? 'resident' : 'employee';
    if (device.userType !== targetType || !targets.includes(device.userId)) {
      violations.push(`non-target ${device.userType}:${device.userId} got ${delivery.event} of ${call.id}`);
    }

    if (delivery.collapseKey !== null && delivery.collapseKey !== `call-${call.id}`) {
      violations.push(`wrong collapse key ${delivery.collapseKey} for ${call.id}`);
    }

    if (delivery.event === 'incoming') {
      // THE bug: an invitation must never start once the call stopped ringing.
      if (delivery.statusAtSend !== 'ringing') {
        violations.push(`incoming for ${call.id} sent to ${delivery.token} while ${delivery.statusAtSend}`);
      }
      if (delivery.expiresAt !== null) {
        const remaining = delivery.expiresAt - delivery.at;
        if (remaining < 1_000) violations.push(`incoming for ${call.id} sent with ${remaining}ms left`);
        if (delivery.ttlMs === null || delivery.ttlMs > remaining + 999 || delivery.ttlMs < 999) {
          violations.push(`incoming ttl ${delivery.ttlMs} outside (0, ${remaining}] for ${call.id}`);
        }
      }
    }

    // Exactly-once per physical token: invitations always, state events unless a crash forced at-least-once.
    const key = `${delivery.callId}|${delivery.event}|${delivery.token}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const [key, count] of counts) {
    const isIncoming = key.split('|')[1] === 'incoming';
    if (count > 1 && (isIncoming || !allowStateDuplicates)) {
      violations.push(`token received ${key} ${count} times`);
    }
  }

  // Once a provider reports a token as dead it is deactivated and not used
  // again. (A request that failed as a whole reports nothing per token.)
  const deadAttempts = new Map<string, number>();
  for (const attempt of world.attempts) {
    if (attempt.outcome === 'dead' && !attempt.crashed) {
      deadAttempts.set(attempt.token, (deadAttempts.get(attempt.token) ?? 0) + 1);
    }
  }
  for (const [token, count] of deadAttempts) {
    const device = deviceByToken.get(token);
    if (device?.isActive) violations.push(`dead token ${token} is still active`);
    // Only jobs already in flight when the first failure was saved may hit it again.
    if (count > instances + 1) violations.push(`dead token ${token} attempted ${count} times`);
  }

  for (const job of jobs) {
    if (job.status === 'pending' || job.status === 'processing') {
      violations.push(`job ${job.event}/${job.channel} for ${job.callSessionId} never finished (${job.status})`);
    }
    // A crashed attempt never finished, so recovery may run one extra attempt per crash.
    if (job.attempts > 6 + world.crashes) violations.push(`job ${job.id} attempted ${job.attempts} times`);

    const call = world.calls.get(job.callSessionId);
    if (!call) continue;
    const targets = call.direction === 'outbound' ? call.targetResidentIds : call.targetEmployeeIds;
    const targetType = call.direction === 'outbound' ? 'resident' : 'employee';
    const channelDevices = devices.filter(
      (device) =>
        device.userType === targetType &&
        targets.includes(device.userId) &&
        device.channel === job.channel &&
        (job.channel !== 'voip' || device.platform === 'ios'),
    );
    const received = new Set(
      world.deliveries
        .filter((delivery) => delivery.callId === call.id && delivery.event === job.event && delivery.channel === job.channel)
        .map((delivery) => delivery.token),
    );

    // Liveness: a job reported as sent reached every healthy device, except
    // callees whose app confirmed through the socket that it shows the call.
    if (job.status === 'sent') {
      const confirmed = job.event === 'incoming' ? (world.showing.get(call.id) ?? new Set<string>()) : new Set<string>();
      for (const device of channelDevices) {
        if (confirmed.has(device.userId)) continue;
        if (world.behaviors.get(device.token) === 'ok' && !received.has(device.token)) {
          violations.push(`job ${job.event}/${job.channel} sent but ok token ${device.token} never got it`);
        }
      }
    }

    // A failure needs a reason: a closed invitation or real provider trouble.
    if (job.status === 'failed') {
      const closed = /ya no está timbrando|venció/.test(job.lastError ?? '');
      const troubled =
        channelDevices.some((device) => ['flaky', 'down'].includes(world.behaviors.get(device.token) ?? 'ok')) ||
        (world.globalFailures.get(`${call.id}|${job.event}|${job.channel}`) ?? 0) > 0;
      if (!closed && !troubled) {
        violations.push(`job ${job.event}/${job.channel} failed without cause: ${job.lastError}`);
      }
      if (closed && job.event !== 'incoming') {
        violations.push(`state event ${job.event} was dropped as closed`);
      }
    }
  }

  return violations;
}

export function silenceLogger() {
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
}

/** Lets every floating promise chain settle without awaiting stuck (crashed) ones. */
export async function settle(rounds = 25) {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}
