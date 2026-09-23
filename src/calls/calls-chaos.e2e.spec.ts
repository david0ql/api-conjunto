/**
 * Chaos tests for calls against the published mobile app behaviour.
 *
 * Needs a disposable PostgreSQL (schema is dropped):
 *   CALLS_PG_URL=postgres://postgres@localhost:55432/calls_push_test npx jest calls-chaos
 * CHAOS_ROUNDS / CHAOS_PARALLEL control the load; CHAOS_SEED replays a run.
 *
 * Every round launches CHAOS_PARALLEL scenarios at the same time on the same
 * API (they also stress the shared "busy porter" checks and the outbox).
 */
import { DataSource } from 'typeorm';
import { SnakeCaseNamingStrategy } from '../common/strategies/snake-case.naming-strategy';
import { ChaosLab, LAB_ENTITIES, RING_MS, sleep, type DeviceApp, type Finding } from './calls-chaos.lab.testspec';
import { pick, randInt, silenceLogger } from './calls-push.simulator.testspec';

const PG_URL = process.env.CALLS_PG_URL;
const ROUNDS = Number(process.env.CHAOS_ROUNDS ?? 2);
const PARALLEL = Number(process.env.CHAOS_PARALLEL ?? 18);
const SEED = Number(process.env.CHAOS_SEED ?? Date.now() % 1_000_000);

const describePg = PG_URL ? describe : describe.skip;

type Scenario = (lab: ChaosLab, name: string) => Promise<DeviceApp[]>;

const jitter = (lab: ChaosLab, min: number, max: number) => sleep(randInt(lab.r, min, max));

const SCENARIOS: Record<string, Scenario> = {
  /** Two residents call the same porter at the same moment. */
  async 'two-calls-same-porter'(lab, name) {
    const apt = await lab.apartment(`A${randInt(lab.r, 100, 999)}`);
    const porter = await lab.porter(name, 'porter', [{}, {}], randInt(lab.r, 0, 8));
    const a = await lab.resident(name, 'res-a', apt, [{ platform: 'android' }]);
    const b = await lab.resident(name, 'res-b', apt, [{ platform: 'ios' }]);
    porter.apps.forEach((app) => (app.policy = { onRing: pick(lab.r, ['answer', 'answer', 'reject', 'ignore'] as const), reactMs: [200, 2_500], talkMs: [300, 2_500] }));
    a.device.startCall('porter', porter.user.id);
    await jitter(lab, 0, 300);
    b.device.startCall('porter', porter.user.id);
    await jitter(lab, 500, 4_000);
    await Promise.all([a.device.hangUp(), b.device.hangUp()]);
    return [...porter.apps, ...a.apps, ...b.apps];
  },

  /** Call, hang up quickly, call again — several times in a row. */
  async 'hang-up-and-redial'(lab, name) {
    const apt = await lab.apartment(`B${randInt(lab.r, 100, 999)}`);
    const porter = await lab.porter(name, 'porter', [{}], 8);
    const res = await lab.resident(name, 'res', apt, [{ platform: pick(lab.r, ['android', 'ios'] as const) }], randInt(lab.r, 0, 3));
    porter.device.policy = { onRing: pick(lab.r, ['answer', 'reject', 'ignore'] as const), reactMs: [100, 2_000], talkMs: [200, 1_500] };
    for (let i = randInt(lab.r, 2, 6); i > 0; i -= 1) {
      await lab.r() < 0.5 ? sleep(0) : jitter(lab, 0, 400);
      res.device.startCall('porter', porter.user.id);
      await jitter(lab, 0, 1_800);
      await res.device.hangUp();
      await jitter(lab, 0, 700);
    }
    return [...porter.apps, ...res.apps];
  },

  /** While one resident hangs up, another resident calls the same porter. */
  async 'call-while-hanging-up'(lab, name) {
    const apt = await lab.apartment(`C${randInt(lab.r, 100, 999)}`);
    const porter = await lab.porter(name, 'porter', [{}], randInt(lab.r, 0, 8));
    const a = await lab.resident(name, 'res-a', apt, [{ platform: 'android' }]);
    const b = await lab.resident(name, 'res-b', apt, [{ platform: pick(lab.r, ['android', 'ios'] as const) }]);
    porter.device.policy = { onRing: 'answer', reactMs: [200, 900], talkMs: [5_000, 6_000] };
    a.device.startCall('porter', porter.user.id);
    await jitter(lab, 1_200, 3_000);
    const offset = randInt(lab.r, -300, 300);
    if (offset < 0) {
      b.device.startCall('porter', porter.user.id);
      await sleep(-offset);
      await a.device.hangUp();
    } else {
      void a.device.hangUp();
      await sleep(offset);
      b.device.startCall('porter', porter.user.id);
    }
    await jitter(lab, 1_000, 3_000);
    await b.device.hangUp();
    return [...porter.apps, ...a.apps, ...b.apps];
  },

  /** The porter calls the apartment while a resident of it calls the porter. */
  async 'cross-call'(lab, name) {
    const apt = await lab.apartment(`D${randInt(lab.r, 100, 999)}`);
    const porter = await lab.porter(name, 'porter', [{}]);
    const a = await lab.resident(name, 'res-a', apt, [{ platform: 'android' }, { platform: 'ios' }]);
    const b = await lab.resident(name, 'res-b', apt, [{ platform: 'ios' }]);
    [...a.apps, ...b.apps, ...porter.apps].forEach((app) => (app.policy = { onRing: pick(lab.r, ['answer', 'reject', 'ignore'] as const), reactMs: [100, 1_500], talkMs: [300, 1_500] }));
    const offset = randInt(lab.r, -250, 250);
    if (offset < 0) {
      porter.device.startCall('apartment', apt);
      await sleep(-offset);
      a.device.startCall('porter', porter.user.id);
    } else {
      a.device.startCall('porter', porter.user.id);
      await sleep(offset);
      porter.device.startCall('apartment', apt);
    }
    await jitter(lab, 2_000, 5_000);
    await Promise.all([porter.device.hangUp(), a.device.hangUp()]);
    return [...porter.apps, ...a.apps, ...b.apps];
  },

  /** A resident is talking with one porter when another porter calls the apartment. */
  async 'resident-busy-other-porter-calls'(lab, name) {
    const apt = await lab.apartment(`E${randInt(lab.r, 100, 999)}`);
    const p1 = await lab.porter(name, 'porter-1', [{}]);
    const p2 = await lab.porter(name, 'porter-2', [{}]);
    const res = await lab.resident(name, 'res', apt, [{ platform: pick(lab.r, ['android', 'ios'] as const) }]);
    p1.device.policy = { onRing: 'answer', reactMs: [200, 600], talkMs: [6_000, 7_000] };
    res.device.policy = { onRing: pick(lab.r, ['answer', 'reject', 'ignore'] as const), reactMs: [300, 1_200], talkMs: [300, 1_000] };
    res.device.startCall('porter', p1.user.id);
    await jitter(lab, 1_500, 2_500);
    p2.device.startCall('apartment', apt);
    await jitter(lab, 3_000, 5_000);
    await Promise.all([p2.device.hangUp(), res.device.hangUp(), p1.device.hangUp()]);
    return [...p1.apps, ...p2.apps, ...res.apps];
  },

  /** Porter logged in on two phones: one answers and the other rejects at the same instant. */
  async 'answer-reject-race'(lab, name) {
    const apt = await lab.apartment(`F${randInt(lab.r, 100, 999)}`);
    const porter = await lab.porter(name, 'porter', [{}, {}]);
    const res = await lab.resident(name, 'res', apt, [{ platform: 'android' }]);
    porter.apps.forEach((app) => (app.policy = { onRing: 'ignore', reactMs: [0, 0], talkMs: [800, 2_000] }));
    res.device.startCall('porter', porter.user.id);
    await jitter(lab, 900, 1_600);
    const [first, second] = lab.r() < 0.5 ? porter.apps : [...porter.apps].reverse();
    first.acceptCurrentCall();
    await jitter(lab, 0, 120);
    second.rejectCurrentCall();
    await jitter(lab, 2_000, 3_000);
    await res.device.hangUp();
    return [...porter.apps, ...res.apps];
  },

  /** Porter calls an apartment with three residents: two answer at once, one rejects. */
  async 'apartment-answer-race'(lab, name) {
    const apt = await lab.apartment(`G${randInt(lab.r, 100, 999)}`);
    const porter = await lab.porter(name, 'porter', [{}]);
    const residents = [
      await lab.resident(name, 'res-a', apt, [{ platform: 'android' }, { platform: 'ios' }], 2),
      await lab.resident(name, 'res-b', apt, [{ platform: 'ios' }]),
      await lab.resident(name, 'res-c', apt, [{ platform: 'android', health: 'flaky' }]),
    ];
    residents.flatMap((res) => res.apps).forEach((app) => (app.policy = { onRing: 'ignore', reactMs: [0, 0], talkMs: [500, 2_000] }));
    porter.device.startCall('apartment', apt);
    await jitter(lab, 1_000, 2_500);
    residents[0].device.acceptCurrentCall();
    await jitter(lab, 0, 80);
    residents[1].device.acceptCurrentCall();
    residents[2].device.rejectCurrentCall();
    await jitter(lab, 1_500, 3_000);
    await porter.device.hangUp();
    return [porter, ...residents].flatMap((user) => user.apps);
  },

  /** The resident answers at the exact moment the porter gives up and hangs up. */
  async 'hang-up-while-answering'(lab, name) {
    const apt = await lab.apartment(`H${randInt(lab.r, 100, 999)}`);
    const porter = await lab.porter(name, 'porter', [{}]);
    const res = await lab.resident(name, 'res', apt, [{ platform: pick(lab.r, ['android', 'ios'] as const) }], randInt(lab.r, 0, 4));
    res.device.policy = { onRing: 'ignore', reactMs: [0, 0], talkMs: [500, 1_500] };
    porter.device.startCall('apartment', apt);
    await jitter(lab, 1_000, RING_MS - 500);
    const offset = randInt(lab.r, -150, 150);
    if (offset < 0) {
      res.device.acceptCurrentCall();
      await sleep(-offset);
      await porter.device.hangUp();
    } else {
      void porter.device.hangUp();
      await sleep(offset);
      res.device.acceptCurrentCall();
    }
    await jitter(lab, 1_500, 2_500);
    await res.device.hangUp();
    return [...porter.apps, ...res.apps];
  },

  /** Nobody answers: the call times out while the caller spams redial right after. */
  async 'timeout-then-redial'(lab, name) {
    const apt = await lab.apartment(`I${randInt(lab.r, 100, 999)}`);
    const porter = await lab.porter(name, 'porter', [{ health: 'flaky' }], 6);
    const res = await lab.resident(name, 'res', apt, [{ platform: 'android' }]);
    porter.device.policy = { onRing: 'ignore', reactMs: [0, 0], talkMs: [0, 0] };
    res.device.startCall('porter', porter.user.id);
    await sleep(RING_MS + randInt(lab.r, -300, 900));
    for (let i = 0; i < 3; i += 1) {
      res.device.startCall('porter', porter.user.id);
      await jitter(lab, 50, 400);
    }
    porter.device.policy = { onRing: 'answer', reactMs: [100, 800], talkMs: [300, 900] };
    await jitter(lab, 2_000, 3_000);
    await res.device.hangUp();
    return [...porter.apps, ...res.apps];
  },

  /** The porter rejects instantly, again and again: late pushes must not ring again. */
  async 'quick-reject-storm'(lab, name) {
    const apt = await lab.apartment(`K${randInt(lab.r, 100, 999)}`);
    const porter = await lab.porter(name, 'porter', [{}, {}], 8);
    const res = await lab.resident(name, 'res', apt, [{ platform: 'android' }]);
    porter.apps.forEach((app) => (app.policy = { onRing: 'reject', reactMs: [30, 250], talkMs: [0, 0] }));
    for (let i = 0; i < 6; i += 1) {
      res.device.startCall('porter', porter.user.id);
      await jitter(lab, 700, 1_400);
      await res.device.hangUp(1_000);
      await jitter(lab, 50, 300);
    }
    return [...porter.apps, ...res.apps];
  },

  /** Random storm of actions between porters and residents. */
  async 'random-storm'(lab, name) {
    const apt = await lab.apartment(`J${randInt(lab.r, 100, 999)}`);
    const porters = [await lab.porter(name, 'porter-1', [{}], randInt(lab.r, 0, 8)), await lab.porter(name, 'porter-2', [{}, {}])];
    const residents = [
      await lab.resident(name, 'res-a', apt, [{ platform: 'android' }], randInt(lab.r, 0, 3)),
      await lab.resident(name, 'res-b', apt, [{ platform: 'ios' }, { platform: 'android' }]),
    ];
    const everyone = [...porters, ...residents];
    everyone.flatMap((user) => user.apps).forEach((app) => (app.policy = { onRing: pick(lab.r, ['answer', 'reject', 'ignore'] as const), reactMs: [0, 2_000], talkMs: [0, 2_500] }));
    const until = Date.now() + randInt(lab.r, 6_000, 14_000);
    while (Date.now() < until) {
      const actor = pick(lab.r, everyone);
      const app = pick(lab.r, actor.apps);
      const roll = lab.r();
      if (roll < 0.35) {
        if (actor.user.type === 'resident') app.startCall('porter', pick(lab.r, porters).user.id);
        else if (lab.r() < 0.7) app.startCall('apartment', apt);
        else app.startCall('employee', porters.find((p) => p !== actor)!.user.id);
      } else if (roll < 0.55) app.acceptCurrentCall();
      else if (roll < 0.7) app.rejectCurrentCall();
      else void app.hangUp(1_000);
      await jitter(lab, 0, 700);
    }
    await Promise.all(everyone.flatMap((user) => user.apps).map((app) => app.hangUp()));
    return everyone.flatMap((user) => user.apps);
  },
};

const HAMMER = Number(process.env.CHAOS_HAMMER ?? 60);
// The hammer closes calls straight in SQL between iterations, so phones are
// not told; only server-side findings are meaningful there.
const serverFindings = (lab: ChaosLab) =>
  lab.findings.filter((finding) => finding.kind === 'server-state' || finding.kind === 'server-error');

describePg('Calls chaos (real gateway + Postgres + published app logic)', () => {
  let source: DataSource;

  beforeAll(async () => {
    silenceLogger();
    source = new DataSource({
      type: 'postgres',
      url: PG_URL,
      entities: LAB_ENTITIES,
      synchronize: true,
      dropSchema: true,
      namingStrategy: new SnakeCaseNamingStrategy(),
      poolSize: 20,
      logging: false,
    });
    await source.initialize();
  }, 60_000);

  afterAll(async () => {
    await source?.destroy();
  });

  /**
   * Server races fired without network latency so they collide within
   * milliseconds: every iteration runs the operations truly concurrently.
   */
  describe('server race hammer', () => {
    let lab: ChaosLab;

    beforeAll(async () => {
      lab = new ChaosLab(source, SEED + 999);
      await lab.start();
    }, 60_000);

    afterAll(async () => {
      await lab.stop();
    });

    const openCallsFor = async (userId: string) => {
      const rows = await source.query(
        `SELECT id FROM call_sessions WHERE status IN ('ringing', 'active')
         AND (initiated_by_employee_id = $1 OR initiated_by_resident_id = $1 OR accepted_by_employee_id = $1
              OR accepted_by_resident_id = $1 OR target_employee_ids LIKE '%' || $1 || '%' OR target_resident_ids LIKE '%' || $1 || '%')`,
        [userId],
      );
      return rows.length as number;
    };

    const closeAll = async () => {
      await source.query(`UPDATE call_sessions SET status = 'ended', ended_at = NOW(), ended_reason = 'hammer_reset' WHERE status IN ('ringing', 'active')`);
    };

    const createdBy = async (userId: string, since: Date) =>
      (await source.query(
        `SELECT id, status FROM call_sessions WHERE (initiated_by_resident_id = $1 OR initiated_by_employee_id = $1) AND created_at >= $2 ORDER BY created_at`,
        [userId, since],
      )) as Array<{ id: string; status: string }>;

    it(`accept vs reject from two phones of the same porter never ends "rejected" after accepting (×${HAMMER})`, async () => {
      const scenario = 'hammer-accept-reject';
      const apt = await lab.apartment('HM1');
      const porter = await lab.porter(scenario, 'porter', [{}, {}]);
      const res = await lab.resident(scenario, 'res', apt, [{ platform: 'android' }]);
      for (let i = 0; i < HAMMER; i += 1) {
        const since = new Date(Date.now() - 1);
        await lab.dispatch(res.device.socket, 'calls:call-porter', { employeeId: porter.user.id });
        const [call] = await createdBy(res.user.id, since);
        const [phoneA, phoneB] = i % 2 ? porter.apps : [...porter.apps].reverse();
        await Promise.all([
          lab.dispatch(phoneA.socket, 'calls:accept', { callId: call.id }),
          lab.dispatch(phoneB.socket, 'calls:reject', { callId: call.id }),
        ]);
        const [row] = await source.query(`SELECT status, accepted_by_employee_id FROM call_sessions WHERE id = $1`, [call.id]);
        if (row.accepted_by_employee_id) expect({ i, status: row.status }).toEqual({ i, status: 'active' });
        else expect({ i, status: row.status }).toEqual({ i, status: 'rejected' });
        await lab.dispatch(res.device.socket, 'calls:end', { callId: call.id });
      }
      expect(serverFindings(lab)).toEqual([]);
    }, 300_000);

    it(`two residents calling the same porter at once: only one call rings (×${HAMMER})`, async () => {
      const scenario = 'hammer-double-call';
      const apt = await lab.apartment('HM2');
      const porter = await lab.porter(scenario, 'porter', [{}]);
      const callers = await Promise.all([0, 1, 2, 3].map((i) => lab.resident(scenario, `res-${i}`, apt, [{ platform: 'android' }])));
      for (let i = 0; i < HAMMER; i += 1) {
        await Promise.all(callers.map((caller) => lab.dispatch(caller.device.socket, 'calls:call-porter', { employeeId: porter.user.id })));
        expect({ i, open: await openCallsFor(porter.user.id) }).toEqual({ i, open: 1 });
        await closeAll();
      }
      expect(serverFindings(lab)).toEqual([]);
    }, 300_000);

    it(`porter calls the apartment while its resident calls the porter: never two open calls (×${HAMMER})`, async () => {
      const scenario = 'hammer-cross';
      const apt = await lab.apartment('HM3');
      const porter = await lab.porter(scenario, 'porter', [{}]);
      const res = await lab.resident(scenario, 'res', apt, [{ platform: 'ios' }]);
      for (let i = 0; i < HAMMER; i += 1) {
        await Promise.all([
          lab.dispatch(porter.device.socket, 'calls:initiate', { apartmentId: apt }),
          lab.dispatch(res.device.socket, 'calls:call-porter', { employeeId: porter.user.id }),
        ]);
        expect({ i, porter: await openCallsFor(porter.user.id), resident: await openCallsFor(res.user.id) }).toEqual({ i, porter: 1, resident: 1 });
        await closeAll();
      }
    }, 300_000);

    it(`two porters calling a busy resident's apartment at once: the resident is never double-booked (×${HAMMER})`, async () => {
      const scenario = 'hammer-busy-resident';
      const apt = await lab.apartment('HM4');
      const porters = await Promise.all([0, 1, 2].map((i) => lab.porter(scenario, `porter-${i}`, [{}])));
      const res = await lab.resident(scenario, 'res', apt, [{ platform: 'android' }]);
      for (let i = 0; i < HAMMER; i += 1) {
        await Promise.all(porters.map((porter) => lab.dispatch(porter.device.socket, 'calls:initiate', { apartmentId: apt })));
        expect({ i, open: await openCallsFor(res.user.id) }).toEqual({ i, open: 1 });
        await closeAll();
      }
    }, 300_000);

    it(`two residents answering the same apartment call at once: exactly one wins (×${HAMMER})`, async () => {
      const scenario = 'hammer-double-accept';
      const apt = await lab.apartment('HM5');
      const porter = await lab.porter(scenario, 'porter', [{}]);
      const residents = await Promise.all([0, 1, 2].map((i) => lab.resident(scenario, `res-${i}`, apt, [{ platform: 'android' }])));
      for (let i = 0; i < HAMMER; i += 1) {
        const since = new Date(Date.now() - 1);
        await lab.dispatch(porter.device.socket, 'calls:initiate', { apartmentId: apt });
        const [call] = await createdBy(porter.user.id, since);
        await Promise.all(residents.map((res) => lab.dispatch(res.device.socket, 'calls:accept', { callId: call.id })));
        const [row] = await source.query(`SELECT status, accepted_by_resident_id FROM call_sessions WHERE id = $1`, [call.id]);
        expect({ i, status: row.status, accepted: residents.some((res) => res.user.id === row.accepted_by_resident_id) }).toEqual({ i, status: 'active', accepted: true });
        await lab.dispatch(porter.device.socket, 'calls:end', { callId: call.id });
      }
      expect(serverFindings(lab)).toEqual([]);
    }, 300_000);

    it(`caller hangs up at the exact moment the callee answers: never active after ended (×${HAMMER})`, async () => {
      const scenario = 'hammer-end-accept';
      const apt = await lab.apartment('HM6');
      const porter = await lab.porter(scenario, 'porter', [{}]);
      const res = await lab.resident(scenario, 'res', apt, [{ platform: 'ios' }]);
      for (let i = 0; i < HAMMER; i += 1) {
        const since = new Date(Date.now() - 1);
        await lab.dispatch(porter.device.socket, 'calls:initiate', { apartmentId: apt });
        const [call] = await createdBy(porter.user.id, since);
        await Promise.all([
          lab.dispatch(porter.device.socket, 'calls:end', { callId: call.id }),
          lab.dispatch(res.device.socket, 'calls:accept', { callId: call.id }),
        ]);
        const [row] = await source.query(`SELECT status FROM call_sessions WHERE id = $1`, [call.id]);
        if (row.status === 'active') await lab.dispatch(porter.device.socket, 'calls:end', { callId: call.id });
        const [final] = await source.query(`SELECT status FROM call_sessions WHERE id = $1`, [call.id]);
        expect({ i, status: final.status }).toEqual({ i, status: 'ended' });
      }
      expect(serverFindings(lab)).toEqual([]);
    }, 300_000);

    it(`a callee pressing "hang up" on an unanswered call rejects it (×${Math.ceil(HAMMER / 4)})`, async () => {
      const scenario = 'hammer-callee-end';
      const apt = await lab.apartment('HM7');
      const porter = await lab.porter(scenario, 'porter', [{}]);
      const res = await lab.resident(scenario, 'res', apt, [{ platform: 'android' }]);
      for (let i = 0; i < Math.ceil(HAMMER / 4); i += 1) {
        const since = new Date(Date.now() - 1);
        await lab.dispatch(res.device.socket, 'calls:call-porter', { employeeId: porter.user.id });
        const [call] = await createdBy(res.user.id, since);
        await lab.dispatch(porter.device.socket, 'calls:end', { callId: call.id });
        const [row] = await source.query(`SELECT status FROM call_sessions WHERE id = $1`, [call.id]);
        expect({ i, status: row.status }).toEqual({ i, status: 'rejected' });
      }
    }, 120_000);

    it.each([100, 300, 600, 1_000, 1_500])(
      'a push delivered 3s late never rings again after the callee rejected at %ims (Android porter and iOS resident)',
      async (rejectAfterMs) => {
        const scenario = `late-push-${rejectAfterMs}`;
        const apt = await lab.apartment(`LP${rejectAfterMs}`);
        const porter = await lab.porter(scenario, 'porter', [{}]);
        const res = await lab.resident(scenario, 'res', apt, [{ platform: 'ios' }]);
        lab.fixedPushLatencyMs = 3_000;
        try {
          porter.device.policy = { onRing: 'reject', reactMs: [rejectAfterMs, rejectAfterMs], talkMs: [0, 0] };
          res.device.policy = { onRing: 'reject', reactMs: [rejectAfterMs, rejectAfterMs], talkMs: [0, 0] };
          res.device.startCall('porter', porter.user.id);
          await sleep(RING_MS + 6_000);
          await porter.device.hangUp();
          porter.device.startCall('apartment', apt);
          await sleep(RING_MS + 6_000);

          for (const app of [porter.device, res.device]) {
            const perCall = new Map<string, number>();
            app.rings.forEach((ring) => perCall.set(ring.callId, (perCall.get(ring.callId) ?? 0) + 1));
            expect({ app: app.name, rings: [...perCall.values()] }).toEqual({ app: app.name, rings: [1] });
            expect({ app: app.name, phase: app.store.phase }).toEqual({ app: app.name, phase: 'idle' });
            expect([...app.native.values()].every((state) => state === 'ended')).toBe(true);
          }
        } finally {
          lab.fixedPushLatencyMs = null;
        }
      },
      60_000,
    );

    it('a phone that never confirms the invitation (frozen app, dead socket) still gets the push and rings', async () => {
      const scenario = 'no-ack-still-rings';
      const apt = await lab.apartment('NA1');
      const porter = await lab.porter(scenario, 'porter', [{}]);
      const res = await lab.resident(scenario, 'res', apt, [{ platform: 'android' }]);
      porter.device.sendsTraces = false;
      porter.device.policy = { onRing: 'ignore', reactMs: [0, 0], talkMs: [0, 0] };
      // The socket "is connected" for the server but the app never processes its events.
      porter.device.onSocket = () => undefined;
      lab.fixedPushLatencyMs = 300;
      try {
        const startedAt = Date.now();
        res.device.startCall('porter', porter.user.id);
        await sleep(4_500);

        const sent = lab.world.deliveries.filter((d) => d.token.startsWith(`fcm-${porter.user.id}`) && d.event === 'incoming');
        expect(sent).toHaveLength(1);
        expect(sent[0].at - startedAt).toBeGreaterThanOrEqual(2_400);
        expect(porter.device.rings.map((ring) => ring.source)).toEqual(['fcm']);
        await res.device.hangUp();
      } finally {
        lab.fixedPushLatencyMs = null;
      }
    }, 60_000);

    it('an offline callee (no socket) gets the push immediately', async () => {
      const scenario = 'offline-immediate-push';
      const apt = await lab.apartment('OF1');
      const porter = await lab.porter(scenario, 'porter', [{}]);
      const res = await lab.resident(scenario, 'res', apt, [{ platform: 'android' }]);
      lab.fixedPushLatencyMs = 200;
      try {
        porter.device.policy = { onRing: 'ignore', reactMs: [0, 0], talkMs: [0, 0] };
        lab.gateway.handleDisconnect(porter.device.socket as never);
        porter.device.onSocket = () => undefined;
        const startedAt = Date.now();
        res.device.startCall('porter', porter.user.id);
        await sleep(2_000);

        expect(porter.device.rings).toHaveLength(1);
        expect(porter.device.rings[0].source).toBe('fcm');
        expect(porter.device.rings[0].at - startedAt).toBeLessThan(1_500);
        await res.device.hangUp();
      } finally {
        lab.fixedPushLatencyMs = null;
      }
    }, 60_000);

    it('"reject" pressed during an active call by the caller or by the phone that answered hangs up; the other phone is ignored', async () => {
      const scenario = 'hammer-stale-reject';
      const apt = await lab.apartment('SR1');
      const porter = await lab.porter(scenario, 'porter', [{}, {}]);
      const res = await lab.resident(scenario, 'res', apt, [{ platform: 'android' }]);
      const [answering, other] = porter.apps;
      const statusOf = async (id: string) => (await source.query(`SELECT status FROM call_sessions WHERE id = $1`, [id]))[0].status;
      const newCall = async () => {
        const since = new Date(Date.now() - 1);
        await lab.dispatch(res.device.socket, 'calls:call-porter', { employeeId: porter.user.id });
        const [call] = await createdBy(res.user.id, since);
        await lab.dispatch(answering.socket, 'calls:accept', { callId: call.id });
        return call.id as string;
      };

      const first = await newCall();
      await lab.dispatch(other.socket, 'calls:reject', { callId: first });
      expect(await statusOf(first)).toBe('active');
      await lab.dispatch(answering.socket, 'calls:reject', { callId: first });
      expect(await statusOf(first)).toBe('ended');

      const second = await newCall();
      await lab.dispatch(res.device.socket, 'calls:reject', { callId: second });
      expect(await statusOf(second)).toBe('ended');
    }, 60_000);

    it('a resident rejecting on one phone stops the invitation on their other phones while others keep ringing', async () => {
      const scenario = 'hammer-reject-other-phone';
      const apt = await lab.apartment('RO1');
      const porter = await lab.porter(scenario, 'porter', [{}]);
      const a = await lab.resident(scenario, 'res-a', apt, [{ platform: 'android' }, { platform: 'ios' }]);
      const b = await lab.resident(scenario, 'res-b', apt, [{ platform: 'android' }]);
      [...a.apps, ...b.apps].forEach((app) => (app.policy = { onRing: 'ignore', reactMs: [0, 0], talkMs: [0, 0] }));
      porter.device.startCall('apartment', apt);
      await sleep(1_500);
      a.apps[0].rejectCurrentCall();
      await sleep(1_500);

      expect(a.apps[1].store.phase).toBe('idle');
      expect([...a.apps[1].native.values()]).toEqual(['ended']);
      expect(b.device.store.phase).toBe('incoming');
      await porter.device.hangUp();
      await sleep(1_500);
      expect(b.device.store.phase).toBe('idle');
    }, 60_000);

    it('a refused call tells the caller with calls:error so the app leaves "calling…"', async () => {
      const scenario = 'hammer-calls-error';
      const apt = await lab.apartment('HM8');
      const porter = await lab.porter(scenario, 'porter', [{}]);
      const [a, b] = await Promise.all([0, 1].map((i) => lab.resident(scenario, `res-${i}`, apt, [{ platform: 'android' }])));
      a.device.startCall('porter', porter.user.id);
      await sleep(800);
      b.device.startCall('porter', porter.user.id);
      await sleep(1_500);
      expect(b.device.store.phase).toBe('idle');
      await a.device.hangUp();
    }, 60_000);
  });

  it(`survives ${ROUNDS} rounds × ${PARALLEL} simultaneous crazy scenarios (seed ${SEED})`, async () => {
    const all: Finding[] = [];
    const counts: Record<string, number> = {};
    const names = Object.keys(SCENARIOS);

    for (let round = 0; round < ROUNDS; round += 1) {
      const lab = new ChaosLab(source, SEED + round);
      await lab.start();
      try {
        await Promise.all(
          Array.from({ length: PARALLEL }, async (_, i) => {
            const kind = names[(i + round) % names.length];
            const name = `${kind}#${round}.${i}`;
            counts[kind] = (counts[kind] ?? 0) + 1;
            await sleep(randInt(lab.r, 0, 1_500));
            const apps = await SCENARIOS[kind](lab, name);
            await lab.settle(apps.map((app) => app.user.id));
            await lab.verify(name, apps);
          }),
        );
      } finally {
        await lab.stop();
      }
      all.push(...lab.findings);
    }

    const byKind = all.reduce<Record<string, number>>((acc, finding) => {
      acc[`${finding.kind} @ ${finding.scenario.split('#')[0]}`] = (acc[`${finding.kind} @ ${finding.scenario.split('#')[0]}`] ?? 0) + 1;
      return acc;
    }, {});
    console.log(
      `CHAOS seed=${SEED} scenarios=${JSON.stringify(counts)}\nfindings=${JSON.stringify(byKind, null, 1)}\n` +
        all.slice(0, 60).map((finding) => `  [${finding.kind}] ${finding.scenario}: ${finding.detail}`).join('\n'),
    );
    expect(all).toEqual([]);
  }, 1_800_000);
});
