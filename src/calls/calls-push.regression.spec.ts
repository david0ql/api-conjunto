/**
 * Deterministic regression tests for "the phone keeps ringing after answering"
 * and "the resident receives 8 consecutive calls".
 *
 * Root cause (production, 2026-09-16): the porter account had 10 FCM tokens,
 * 8 of them dead. firebase-admin reported them as message "NotRegistered",
 * which the service did not recognise, so every job threw, was retried up to
 * 6 times and re-sent the invitation to the healthy phones — even after the
 * call had been answered, rejected or ended.
 */
import type { CallsPushService } from './calls-push.service';
import type { CallSessionPayload } from './calls.types';
import type { CallPushEvent } from './entities/call-push-job.entity';
import {
  MemoryOutbox,
  PushWorld,
  checkInvariants,
  createRng,
  settle,
  silenceLogger,
  type TokenBehavior,
} from './calls-push.simulator.testspec';

const START = Date.UTC(2026, 8, 16, 19, 18, 2);
const RING_MS = 45_000;

type Direction = CallSessionPayload['direction'];

function makeCall(overrides: Partial<CallSessionPayload> = {}): CallSessionPayload {
  const direction = overrides.direction ?? 'inbound';
  const createdAt = Date.now();
  return {
    id: 'call-1',
    status: 'ringing',
    direction,
    apartmentId: direction === 'outbound' ? 'apt-710' : null,
    apartment: null,
    initiatedByEmployeeId: direction === 'inbound' ? null : 'porter-2',
    initiatedByEmployee: null,
    initiatedByResidentId: direction === 'inbound' ? 'resident-710' : null,
    initiatedByResident: null,
    acceptedByResidentId: null,
    acceptedByResident: null,
    acceptedByEmployeeId: null,
    acceptedByEmployee: null,
    targetResidentIds: direction === 'outbound' ? ['resident-710', 'resident-710-b'] : [],
    targetEmployeeIds: direction === 'outbound' ? [] : ['porter-1'],
    rejectedResidentIds: [],
    rejectedEmployeeIds: [],
    endedByUserId: null,
    endedByUserType: null,
    endedReason: null,
    createdAt: new Date(createdAt).toISOString(),
    acceptedAt: null,
    endedAt: null,
    expiresAt: new Date(createdAt + RING_MS).toISOString(),
    ...overrides,
  };
}

class Harness {
  readonly world: PushWorld;
  readonly outbox: MemoryOutbox;
  readonly services: CallsPushService[];

  constructor(seed = 1, instances = 1) {
    const r = createRng(seed);
    this.world = new PushWorld(r);
    this.outbox = new MemoryOutbox(r);
    this.services = Array.from({ length: instances }, () => this.outbox.createService(this.world));
    global.fetch = this.world.fetch as never;
  }

  get service() {
    return this.services[0];
  }

  device(
    userId: string,
    token: string,
    behavior: TokenBehavior,
    options: { userType?: 'resident' | 'employee'; platform?: 'android' | 'ios'; channel?: 'fcm' | 'hms' | 'voip'; deviceId?: string } = {},
  ) {
    this.world.behaviors.set(token, behavior);
    return this.outbox.addDevice({
      userId,
      userType: options.userType ?? 'employee',
      platform: options.platform ?? 'android',
      channel: options.channel ?? 'fcm',
      token,
      deviceId: options.deviceId ?? `phone-${token}`,
    });
  }

  async start(call: CallSessionPayload) {
    this.world.calls.set(call.id, call);
    await this.service.sendIncomingCall({ ...call });
    await settle();
  }

  async transition(call: CallSessionPayload, status: CallSessionPayload['status'], event?: Exclude<CallPushEvent, 'incoming'>) {
    call.status = status;
    if (event) await this.service.sendCallState({ ...call }, event);
    await settle();
  }

  /** Advances the clock like the 1s worker interval does in production. */
  async run(ms: number, stepMs = 250) {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      jest.setSystemTime(Date.now() + stepMs);
      for (const service of this.services) {
        void (service as unknown as { processPendingJobs: () => Promise<void> }).processPendingJobs();
      }
      await settle(4);
    }
    await settle();
  }

  deliveries(event: CallPushEvent, token?: string) {
    return this.world.deliveries.filter((delivery) => delivery.event === event && (!token || delivery.token === token));
  }

  requested(token: string) {
    return this.world.attempts.filter((attempt) => attempt.token === token);
  }

  job(event: CallPushEvent, channel = 'fcm') {
    const job = this.outbox.jobs.find((item) => item.event === event && item.channel === channel);
    if (!job) throw new Error(`no ${event}/${channel} job`);
    return job;
  }

  violations(allowStateDuplicates = false) {
    return checkInvariants({
      world: this.world,
      jobs: this.outbox.jobs,
      devices: this.outbox.devices,
      instances: this.services.length,
      allowStateDuplicates,
    });
  }
}

describe('Call push regressions', () => {
  const originalFetch = global.fetch;

  beforeAll(() => silenceLogger());
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
    jest.setSystemTime(START);
  });
  afterEach(() => {
    jest.useRealTimers();
    global.fetch = originalFetch;
  });
  afterAll(() => jest.restoreAllMocks());

  describe('production replay: porter with 10 FCM tokens, 8 dead', () => {
    const buildPorter = (h: Harness) => {
      const dead = Array.from({ length: 8 }, (_, i) => h.device('porter-1', `dead-${i}`, 'dead'));
      const live = [h.device('porter-1', 'porter-phone', 'ok'), h.device('porter-1', 'old-tablet', 'ok')];
      return { dead, live };
    };

    it('rings each live phone once and never again after the porter answers', async () => {
      const h = new Harness();
      buildPorter(h);
      const call = makeCall();
      await h.start(call);
      await h.run(4_000);
      await h.transition(call, 'active'); // porter answers at +4s (inbound: no push)
      await h.run(40_000);
      await h.transition(call, 'ended', 'ended');
      await h.run(180_000);

      expect(h.deliveries('incoming', 'porter-phone')).toHaveLength(1);
      expect(h.deliveries('incoming', 'old-tablet')).toHaveLength(1);
      expect(h.deliveries('incoming').every((delivery) => delivery.at < START + 4_250)).toBe(true);
      expect(h.deliveries('ended', 'porter-phone')).toHaveLength(1);
      expect(h.violations()).toEqual([]);
    });

    it('deactivates the 8 dead tokens on the first push and does not retry because of them', async () => {
      const h = new Harness();
      const { dead } = buildPorter(h);
      const call = makeCall();
      await h.start(call);
      await h.run(60_000);

      expect(h.job('incoming').status).toBe('sent');
      expect(h.job('incoming').attempts).toBe(1);
      for (const device of dead) {
        expect(h.outbox.devices.find((item) => item.token === device.token)?.isActive).toBe(false);
        expect(h.requested(device.token)).toHaveLength(1);
      }
    });

    it('the next call only targets the two live phones', async () => {
      const h = new Harness();
      buildPorter(h);
      const first = makeCall();
      await h.start(first);
      await h.transition(first, 'rejected', 'rejected');
      await h.run(60_000);

      const attemptsBefore = h.world.attempts.length;
      const second = makeCall({ id: 'call-2' });
      await h.start(second);
      await h.run(60_000);

      const secondAttempts = h.world.attempts.slice(attemptsBefore).filter((attempt) => attempt.callId === 'call-2');
      expect(secondAttempts.map((attempt) => attempt.token).sort()).toEqual(['old-tablet', 'porter-phone']);
      expect(h.violations()).toEqual([]);
    });

    it('replays the 14:18 sequence (reject, recall, accept) without extra rings', async () => {
      const h = new Harness();
      buildPorter(h);
      const first = makeCall({ id: 'cc7ebbc4' });
      await h.start(first);
      await h.run(3_000);
      await h.transition(first, 'rejected', 'rejected');
      await h.run(16_000);
      const second = makeCall({ id: 'f552fba7' });
      await h.start(second);
      await h.run(2_000);
      await h.transition(second, 'rejected', 'rejected');
      await h.run(5_000);
      await h.transition(first, 'rejected');
      await h.run(120_000);

      for (const id of ['cc7ebbc4', 'f552fba7']) {
        const perToken = h.world.deliveriesFor(id).filter((delivery) => delivery.event === 'incoming');
        expect(perToken.map((delivery) => delivery.token).sort()).toEqual(['old-tablet', 'porter-phone']);
      }
      expect(h.violations()).toEqual([]);
    });
  });

  describe('resident of apartment 710 receiving "8 consecutive calls"', () => {
    it('each resident device rings once even with dead Android and iOS tokens', async () => {
      const h = new Harness();
      h.device('resident-710', 'android-live', 'ok', { userType: 'resident' });
      h.device('resident-710', 'android-dead', 'dead', { userType: 'resident' });
      h.device('resident-710', 'ios-fcm', 'ok', { userType: 'resident', platform: 'ios' });
      h.device('resident-710', 'ios-voip-live', 'ok', { userType: 'resident', platform: 'ios', channel: 'voip' });
      h.device('resident-710-b', 'ios-voip-dead', 'dead', { userType: 'resident', platform: 'ios', channel: 'voip' });
      h.device('resident-710-b', 'hms-live', 'ok', { userType: 'resident', channel: 'hms' });
      const call = makeCall({ direction: 'outbound' });
      await h.start(call);
      await h.run(8_000);
      await h.transition(call, 'active', 'accepted');
      await h.run(30_000);
      await h.transition(call, 'ended', 'ended');
      await h.run(180_000);

      for (const token of ['android-live', 'ios-fcm', 'ios-voip-live', 'hms-live']) {
        expect(h.deliveries('incoming', token)).toHaveLength(1);
      }
      expect(h.violations()).toEqual([]);
    });
  });

  describe('guards', () => {
    it('does not send an invitation for a call answered before the worker picked it up', async () => {
      const h = new Harness();
      h.device('porter-1', 'phone', 'ok');
      const call = makeCall();
      h.world.calls.set(call.id, call);
      call.status = 'active';
      await h.service.sendIncomingCall({ ...call, status: 'ringing' });
      await h.run(10_000);

      expect(h.deliveries('incoming')).toHaveLength(0);
      expect(h.job('incoming')).toMatchObject({ status: 'failed', lastError: expect.stringContaining('ya no está timbrando (active)') });
    });

    it('does not send an invitation whose call no longer exists', async () => {
      const h = new Harness();
      h.device('porter-1', 'phone', 'ok');
      await h.service.sendIncomingCall(makeCall());
      await h.run(5_000);

      expect(h.deliveries('incoming')).toHaveLength(0);
      expect(h.job('incoming').lastError).toContain('no existe');
    });

    it('does not send an expired invitation even if the reaper has not marked it missed yet', async () => {
      const h = new Harness();
      h.device('porter-1', 'phone', 'flaky');
      h.world.flakyFailureRate = 1;
      const call = makeCall();
      await h.start(call);
      h.world.flakyFailureRate = 0;
      // Worker stalls past the deadline while the session is still "ringing".
      jest.setSystemTime(START + RING_MS + 500);
      await h.run(1_000);

      expect(call.status).toBe('ringing');
      expect(h.deliveries('incoming')).toHaveLength(0);
      expect(h.job('incoming')).toMatchObject({ status: 'failed', lastError: expect.stringContaining('venció') });
    });

    it('never retries an invitation once it is closed', async () => {
      const h = new Harness();
      h.device('porter-1', 'phone', 'down');
      const call = makeCall();
      await h.start(call);
      await h.transition(call, 'ended', 'ended');
      await h.run(120_000);

      expect(h.job('incoming').status).toBe('failed');
      expect(h.requested('phone').filter((attempt) => attempt.event === 'incoming')).toHaveLength(1);
    });

    it('retries only the token that failed transiently', async () => {
      const h = new Harness();
      h.device('porter-1', 'healthy', 'ok');
      h.device('porter-1', 'flaky', 'flaky');
      h.world.flakyFailureRate = 1;
      const call = makeCall();
      await h.start(call);
      h.world.flakyFailureRate = 0;
      await h.run(10_000);

      expect(h.deliveries('incoming', 'healthy')).toHaveLength(1);
      expect(h.deliveries('incoming', 'flaky')).toHaveLength(1);
      expect(h.requested('healthy')).toHaveLength(1);
      expect(h.job('incoming')).toMatchObject({ status: 'sent', attempts: 2 });
    });

    it('keeps delivered tokens when the whole request fails afterwards', async () => {
      const h = new Harness();
      h.device('porter-1', 'healthy', 'ok');
      h.device('porter-1', 'down', 'down');
      const call = makeCall();
      await h.start(call);
      h.world.globalFailureRate = 1;
      await h.run(8_000);
      h.world.globalFailureRate = 0;
      await h.run(30_000);

      expect(h.deliveries('incoming', 'healthy')).toHaveLength(1);
      expect(h.job('incoming').deliveredTokens).toEqual(['healthy']);
    });

    it('sends to a token registered twice only once', async () => {
      const h = new Harness();
      h.device('porter-1', 'same-token', 'ok');
      h.outbox.devices.push({ ...h.outbox.devices[0], id: 'duplicate-row' });
      await h.start(makeCall());
      await h.run(2_000);

      expect(h.requested('same-token')).toHaveLength(1);
    });

    it('creates one job per channel when the gateway enqueues the same event twice', async () => {
      const h = new Harness(1, 3);
      h.device('porter-1', 'phone', 'ok');
      const call = makeCall();
      h.world.calls.set(call.id, call);
      await Promise.all(h.services.map((service) => service.sendIncomingCall({ ...call })));
      await Promise.all(h.services.map((service) => service.sendCallState({ ...call }, 'ended')));
      await h.run(5_000);

      expect(h.outbox.jobs.map((job) => `${job.event}/${job.channel}`).sort()).toEqual(['ended/fcm', 'ended/hms', 'incoming/fcm', 'incoming/hms']);
      expect(h.deliveries('incoming', 'phone')).toHaveLength(1);
    });

    it('recovers a job abandoned by a crashed instance without ringing again', async () => {
      const h = new Harness(7, 2);
      h.device('porter-1', 'phone', 'ok');
      const call = makeCall();
      h.world.crashAfterNextDelivery = true;
      await h.start(call);
      expect(h.job('incoming').status).toBe('processing');
      await h.run(5_000);
      await h.transition(call, 'active');
      jest.setSystemTime(Date.now() + 121_000);
      await (h.services[1] as unknown as { recoverAbandonedJobs: () => Promise<void> }).recoverAbandonedJobs();
      await h.run(5_000);

      expect(h.deliveries('incoming', 'phone')).toHaveLength(1);
      expect(h.job('incoming').status).toBe('failed');
    });
  });

  describe('callees already reached through the socket', () => {
    const showing = (h: Harness, callId: string, userId: string) => {
      const users = h.world.showing.get(callId) ?? new Set<string>();
      users.add(userId);
      h.world.showing.set(callId, users);
    };

    it('does not push to a porter whose app confirmed it is showing the call', async () => {
      const h = new Harness();
      h.device('porter-1', 'phone', 'ok');
      const call = makeCall();
      h.world.calls.set(call.id, call);
      await h.service.sendIncomingCall({ ...call }, { socketUserIds: ['porter-1'] });
      await settle();
      expect(h.deliveries('incoming')).toHaveLength(0);

      showing(h, call.id, 'porter-1');
      await h.run(5_000);

      expect(h.deliveries('incoming')).toHaveLength(0);
      expect(h.job('incoming')).toMatchObject({ status: 'sent', attempts: 1 });
    });

    it('pushes after the confirmation window when the app never confirmed', async () => {
      const h = new Harness();
      h.device('porter-1', 'phone', 'ok');
      const call = makeCall();
      h.world.calls.set(call.id, call);
      await h.service.sendIncomingCall({ ...call }, { socketUserIds: ['porter-1'] });
      await h.run(5_000);

      const [delivery] = h.deliveries('incoming', 'phone');
      expect(delivery.at).toBeGreaterThanOrEqual(START + 2_500);
      expect(delivery.at).toBeLessThanOrEqual(START + 3_000);
      expect(delivery.ttlMs).toBeLessThanOrEqual(RING_MS - 2_500);
    });

    it('serves offline residents at once and online ones only if they did not confirm', async () => {
      const h = new Harness();
      h.device('resident-710', 'offline-phone', 'ok', { userType: 'resident' });
      h.device('resident-710-b', 'online-confirmed', 'ok', { userType: 'resident', platform: 'ios', channel: 'voip' });
      h.device('resident-710-c', 'online-silent', 'ok', { userType: 'resident' });
      const call = makeCall({ direction: 'outbound', targetResidentIds: ['resident-710', 'resident-710-b', 'resident-710-c'] });
      h.world.calls.set(call.id, call);
      await h.service.sendIncomingCall({ ...call }, { socketUserIds: ['resident-710-b', 'resident-710-c', 'someone-else'] });
      await settle();

      expect(h.deliveries('incoming').map((delivery) => delivery.token)).toEqual(['offline-phone']);
      showing(h, call.id, 'resident-710-b');
      await h.run(5_000);

      expect(h.deliveries('incoming').map((delivery) => delivery.token).sort()).toEqual(['offline-phone', 'online-silent']);
      expect(h.violations()).toEqual([]);
    });

    it('never pushes when the call is rejected inside the confirmation window', async () => {
      const h = new Harness();
      h.device('porter-1', 'phone', 'ok');
      const call = makeCall();
      h.world.calls.set(call.id, call);
      await h.service.sendIncomingCall({ ...call }, { socketUserIds: ['porter-1'] });
      await h.run(800);
      await h.transition(call, 'rejected', 'rejected');
      await h.run(10_000);

      expect(h.deliveries('incoming')).toHaveLength(0);
      expect(h.job('incoming').status).toBe('failed');
    });

    it('waiting for the confirmation does not consume the retry budget', async () => {
      const h = new Harness();
      h.device('porter-1', 'phone', 'flaky');
      h.world.flakyFailureRate = 1;
      const call = makeCall();
      h.world.calls.set(call.id, call);
      await h.service.sendIncomingCall({ ...call }, { socketUserIds: ['porter-1'] });
      await h.run(2_900);
      expect(h.job('incoming').attempts).toBe(1);
      h.world.flakyFailureRate = 0;
      await h.run(5_000);

      expect(h.deliveries('incoming', 'phone')).toHaveLength(1);
      expect(h.job('incoming')).toMatchObject({ status: 'sent', attempts: 2 });
    });
  });

  describe('push parameters', () => {
    it('uses the remaining ring time as TTL and one collapse key per call', async () => {
      const h = new Harness();
      h.device('resident-710', 'android', 'ok', { userType: 'resident' });
      h.device('resident-710', 'voip', 'ok', { userType: 'resident', platform: 'ios', channel: 'voip' });
      h.device('resident-710', 'hms', 'ok', { userType: 'resident', channel: 'hms' });
      const call = makeCall({ direction: 'outbound', expiresAt: new Date(START + 12_000).toISOString() });
      await h.start(call);

      const [android] = h.deliveries('incoming', 'android');
      expect(android.ttlMs).toBe(12_000);
      expect(android.collapseKey).toBe('call-call-1');
      const [voip] = h.deliveries('incoming', 'voip');
      expect(voip.ttlMs).toBeLessThanOrEqual(12_000);
      expect(voip.ttlMs).toBeGreaterThan(10_000);
      expect(voip.collapseKey).toBe('call-call-1');
      expect(h.deliveries('incoming', 'hms')[0].ttlMs).toBe(12_000);

      await h.transition(call, 'ended', 'ended');
      expect(h.deliveries('ended', 'android')[0]).toMatchObject({ ttlMs: 60_000, collapseKey: 'call-call-1' });
    });

    it('caps the invitation TTL at 45 seconds', async () => {
      const h = new Harness();
      h.device('porter-1', 'android', 'ok');
      await h.start(makeCall({ expiresAt: new Date(START + 10 * 60_000).toISOString() }));
      expect(h.deliveries('incoming', 'android')[0].ttlMs).toBe(45_000);
    });

    it('deactivates illegal HMS tokens on partial success without retrying', async () => {
      const h = new Harness();
      h.device('porter-1', 'hms-ok', 'ok', { channel: 'hms' });
      h.device('porter-1', 'hms-dead', 'dead', { channel: 'hms' });
      await h.start(makeCall());
      await h.run(30_000);

      expect(h.job('incoming', 'hms')).toMatchObject({ status: 'sent', attempts: 1 });
      expect(h.outbox.devices.find((device) => device.token === 'hms-dead')?.isActive).toBe(false);
      expect(h.deliveries('incoming', 'hms-ok')).toHaveLength(1);
    });

    it('deactivates dead APNs VoIP tokens without retrying', async () => {
      const h = new Harness();
      h.device('resident-710', 'voip-ok', 'ok', { userType: 'resident', platform: 'ios', channel: 'voip' });
      h.device('resident-710', 'voip-dead', 'dead', { userType: 'resident', platform: 'ios', channel: 'voip' });
      await h.start(makeCall({ direction: 'outbound' }));
      await h.run(30_000);

      expect(h.job('incoming', 'voip')).toMatchObject({ status: 'sent', attempts: 1 });
      expect(h.outbox.devices.find((device) => device.token === 'voip-dead')?.isActive).toBe(false);
    });
  });

  describe('device registration', () => {
    const user = { sub: 'porter-1', type: 'employee' } as never;

    it('a new token for the same phone and channel replaces the old one', async () => {
      const h = new Harness();
      h.device('porter-1', 'old-fcm', 'ok', { deviceId: 'phone-A' });
      h.device('porter-1', 'voip-same-phone', 'ok', { deviceId: 'phone-A', channel: 'voip', platform: 'ios' });
      h.device('porter-1', 'other-phone', 'ok', { deviceId: 'phone-B' });

      await h.service.registerDevice(user, { token: 'new-fcm', platform: 'android', channel: 'fcm', deviceId: 'phone-A' });
      const active = (token: string) => h.outbox.devices.find((device) => device.token === token)?.isActive;

      expect(active('new-fcm')).toBe(true);
      expect(active('old-fcm')).toBe(false);
      expect(active('voip-same-phone')).toBe(true);
      expect(active('other-phone')).toBe(true);
    });

    it('re-registering the same token keeps it active', async () => {
      const h = new Harness();
      h.device('porter-1', 'token', 'ok', { deviceId: 'phone-A' });
      await h.service.registerDevice(user, { token: 'token', platform: 'android', channel: 'fcm', deviceId: 'phone-A' });
      expect(h.outbox.devices.filter((device) => device.token === 'token').every((device) => device.isActive)).toBe(true);
    });
  });

  /**
   * Exhaustive grid: every direction × token health profile × moment the call
   * stops ringing (every 250ms from 0 to 50s) × how it stops.
   */
  describe('exhaustive timing grid', () => {
    const profiles: Record<string, TokenBehavior[]> = {
      healthy: ['ok', 'ok'],
      production: ['ok', 'ok', 'dead', 'dead', 'dead', 'dead', 'dead', 'dead', 'dead', 'dead'],
      flaky: ['ok', 'flaky', 'dead'],
      unreachable: ['ok', 'down', 'dead'],
    };
    const endings = ['accept', 'reject', 'cancel'] as const;
    const directions: Direction[] = ['inbound', 'outbound', 'internal'];
    // CALLS_STRESS=1 tightens the grid from 500ms to 100ms.
    const gridStepMs = process.env.CALLS_STRESS ? 100 : 500;
    const delays = Array.from({ length: 50_000 / gridStepMs + 1 }, (_, i) => i * gridStepMs);

    const cases = directions.flatMap((direction) =>
      Object.keys(profiles).flatMap((profile) =>
        endings.map((ending) => ({ direction, profile, ending })),
      ),
    );

    it.each(cases)('$direction · $profile tokens · $ending at every grid step from 0 to 50s', async ({ direction, profile, ending }) => {
      for (const delay of delays) {
        jest.setSystemTime(START);
        const h = new Harness(delay + 1, 2);
        h.world.flakyFailureRate = 0.6;
        const userType = direction === 'outbound' ? 'resident' : 'employee';
        const userId = direction === 'outbound' ? 'resident-710' : 'porter-1';
        profiles[profile].forEach((behavior, i) => {
          const channel = direction === 'outbound' && i % 3 === 2 ? 'voip' : i % 4 === 3 ? 'hms' : 'fcm';
          h.device(userId, `${profile}-${i}`, behavior, { userType, channel, platform: channel === 'voip' ? 'ios' : 'android' });
        });
        const call = makeCall({ direction });
        await h.start(call);
        await h.run(delay);

        const stoppedAt = Date.now();
        const stillRinging = call.status === 'ringing' && stoppedAt < START + RING_MS;
        if (stillRinging && ending === 'accept') await h.transition(call, 'active', direction === 'outbound' ? 'accepted' : undefined);
        else if (stillRinging && ending === 'reject') await h.transition(call, 'rejected', 'rejected');
        else if (stillRinging) await h.transition(call, 'ended', 'ended');
        else if (call.status === 'ringing') await h.transition(call, 'missed', 'missed');
        await h.run(150_000, 1_000);
        if (call.status === 'active') {
          await h.transition(call, 'ended', 'ended');
          await h.run(120_000, 1_000);
        }

        const lateInvites = h.deliveries('incoming').filter((delivery) => delivery.at > stoppedAt);
        const context = `delay=${delay}ms`;
        expect({ context, lateInvites }).toEqual({ context, lateInvites: [] });
        expect({ context, violations: h.violations() }).toEqual({ context, violations: [] });
      }
    }, 900_000);
  });
});
