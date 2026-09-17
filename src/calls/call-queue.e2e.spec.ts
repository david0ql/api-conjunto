/**
 * Waiting list for busy porters, end to end: real gateway + services on
 * PostgreSQL and phones running the published app logic (callback model).
 *
 *   CALLS_PG_URL=postgres://postgres@localhost:55432/calls_chaos npx jest call-queue
 */
import { DataSource } from 'typeorm';
import { SnakeCaseNamingStrategy } from '../common/strategies/snake-case.naming-strategy';
import { ChaosLab, LAB_ENTITIES, RING_MS, sleep } from './calls-chaos.lab.testspec';
import { silenceLogger } from './calls-push.simulator.testspec';

const PG_URL = process.env.CALLS_PG_URL;
const describePg = PG_URL ? describe : describe.skip;

describePg('Call waiting list (callback model)', () => {
  let source: DataSource;
  let lab: ChaosLab;
  let seq = 0;

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

  beforeEach(async () => {
    lab = new ChaosLab(source, 100 + seq++);
    lab.fixedPushLatencyMs = 150;
    await lab.start();
  });

  afterEach(async () => {
    await lab.stop();
  });

  afterAll(async () => {
    await source?.destroy();
  });

  /** A porter busy talking with `talker`. */
  const busyPorter = async (scenario: string) => {
    const apt = await lab.apartment('Q');
    const porter = await lab.porter(scenario, 'porter', [{}]);
    const talker = await lab.resident(scenario, 'talker', apt, [{ platform: 'android' }]);
    porter.device.policy = { onRing: 'answer', reactMs: [100, 100], talkMs: [60_000, 60_000] };
    talker.device.policy = { onRing: 'ignore', reactMs: [0, 0], talkMs: [60_000, 60_000] };
    talker.device.startCall('porter', porter.user.id);
    await sleep(1_500);
    expect(porter.device.store.phase).toBe('active');
    return { porter, talker, apt };
  };

  const waiting = async (employeeId: string) =>
    (await source.query(`SELECT resident_id, employee_id, status, notified_position FROM call_queue_entries WHERE status = 'waiting' AND employee_id = $1 ORDER BY created_at`, [employeeId])) as Array<{
      resident_id: string;
      employee_id: string;
      status: string;
      notified_position: number;
    }>;

  const lastNotification = (app: { notifications: Array<{ body: string }> }) => app.notifications[app.notifications.length - 1]?.body ?? '';

  it('queues a resident who calls a busy porter, tells their position and frees their app', async () => {
    const { porter } = await busyPorter('queue-basic');
    const apt = await lab.apartment('QA');
    const a = await lab.resident('queue-basic', 'res-a', apt, [{ platform: 'android' }]);
    const c = await lab.resident('queue-basic', 'res-c', apt, [{ platform: 'ios' }]);

    a.device.startCall('porter', porter.user.id);
    await sleep(1_000);
    c.device.startCall('porter', porter.user.id);
    await sleep(1_000);

    expect(a.device.store.phase).toBe('idle');
    expect(c.device.store.phase).toBe('idle');
    expect(lastNotification(a.device)).toContain('Estás de 1.º en la fila');
    expect(lastNotification(c.device)).toContain('Estás de 2.º en la fila');
    expect((await waiting(porter.user.id)).map((row) => row.resident_id)).toEqual([a.user.id, c.user.id]);

    const stored = await source.query(
      `SELECT n.message, t.code FROM notifications n JOIN notification_types t ON t.id = n.notification_type_id WHERE n.resident_id = $1`,
      [a.user.id],
    );
    expect(stored).toEqual([expect.objectContaining({ code: 'call_queue', message: expect.stringContaining('1.º') })]);
    expect(porter.device.socketEvents.some((item) => item.event === 'calls:queue-updated' && item.payload.filter((row: { employee: { id: string } }) => row.employee.id === porter.user.id).length === 2)).toBe(true);
    expect(a.device.socketEvents.some((item) => item.event === 'calls:queue-updated')).toBe(false);
  }, 60_000);

  it('calling again while waiting keeps a single turn', async () => {
    const { porter } = await busyPorter('queue-dedupe');
    const a = await lab.resident('queue-dedupe', 'res-a', await lab.apartment('QD'), [{ platform: 'android' }]);
    for (let i = 0; i < 4; i += 1) {
      await lab.dispatch(a.device.socket, 'calls:call-porter', { employeeId: porter.user.id });
    }
    await sleep(800);
    expect(await waiting(porter.user.id)).toHaveLength(1);
    // Each new attempt reminds the same position instead of failing.
    expect(a.device.notifications).toHaveLength(4);
    expect(a.device.notifications.every((item) => item.body.includes('1.º'))).toBe(true);
  }, 60_000);

  it('tells the porter who is next when the call ends, and a connected callback serves the turn', async () => {
    const { porter, talker } = await busyPorter('queue-callback');
    const aptA = await lab.apartment('QC');
    const a = await lab.resident('queue-callback', 'res-a', aptA, [{ platform: 'android' }]);
    const c = await lab.resident('queue-callback', 'res-c', await lab.apartment('QC'), [{ platform: 'android' }]);
    a.device.startCall('porter', porter.user.id);
    await sleep(700);
    c.device.startCall('porter', porter.user.id);
    await sleep(700);

    await talker.device.hangUp();
    await sleep(1_000);
    expect(lastNotification(porter.device)).toMatch(/^Siguiente: Apto .* – res-a Lab\. 2 en espera\.$/);

    a.device.policy = { onRing: 'answer', reactMs: [300, 300], talkMs: [1_000, 1_000] };
    porter.device.startCall('apartment', aptA);
    await sleep(1_500);

    expect((await waiting(porter.user.id)).map((row) => row.resident_id)).toEqual([c.user.id]);
    expect(lastNotification(c.device)).toContain('Eres el siguiente');
    const [served] = await source.query(`SELECT status, served_call_id FROM call_queue_entries WHERE resident_id = $1`, [a.user.id]);
    expect(served.status).toBe('served');
    expect(served.served_call_id).toBeTruthy();

    await sleep(1_500);
    expect(lastNotification(porter.device)).toMatch(/Siguiente: .* res-c Lab\. 1 en espera\./);
  }, 60_000);

  it('an unanswered callback keeps the turn and reminds the porter', async () => {
    const { porter, talker } = await busyPorter('queue-missed-callback');
    const aptA = await lab.apartment('QM');
    const a = await lab.resident('queue-missed-callback', 'res-a', aptA, [{ platform: 'android' }]);
    a.device.startCall('porter', porter.user.id);
    await sleep(700);
    await talker.device.hangUp();
    await sleep(800);
    const before = porter.device.notifications.length;

    a.device.policy = { onRing: 'reject', reactMs: [300, 300], talkMs: [0, 0] };
    porter.device.startCall('apartment', aptA);
    await sleep(2_000);

    expect((await waiting(porter.user.id)).map((row) => row.resident_id)).toEqual([a.user.id]);
    expect(porter.device.notifications.length).toBe(before + 1);
  }, 60_000);

  it('staff can remove a turn; the resident and the ones behind are told', async () => {
    const { porter } = await busyPorter('queue-cancel');
    const a = await lab.resident('queue-cancel', 'res-a', await lab.apartment('QX'), [{ platform: 'android' }]);
    const c = await lab.resident('queue-cancel', 'res-c', await lab.apartment('QX'), [{ platform: 'android' }]);
    a.device.startCall('porter', porter.user.id);
    await sleep(600);
    c.device.startCall('porter', porter.user.id);
    await sleep(600);

    const list = (await lab.queue.list()).filter((item) => item.employee.id === porter.user.id);
    expect(list.map((item) => [item.position, item.resident.id])).toEqual([[1, a.user.id], [2, c.user.id]]);
    await lab.queue.cancel(list[0].id);
    await sleep(500);

    expect(lastNotification(a.device)).toContain('retiró tu turno');
    expect(lastNotification(c.device)).toContain('Eres el siguiente');
    expect((await lab.queue.list()).filter((item) => item.employee.id === porter.user.id).map((item) => item.position)).toEqual([1]);
  }, 60_000);

  it('turns expire after 30 minutes', async () => {
    const { porter } = await busyPorter('queue-expire');
    const a = await lab.resident('queue-expire', 'res-a', await lab.apartment('QE'), [{ platform: 'android' }]);
    a.device.startCall('porter', porter.user.id);
    await sleep(700);
    await source.query(`UPDATE call_queue_entries SET created_at = NOW() - INTERVAL '31 minutes' WHERE resident_id = $1`, [a.user.id]);

    await lab.queue.expireStale();
    await sleep(400);

    expect(await waiting(porter.user.id)).toHaveLength(0);
    expect(lastNotification(a.device)).toContain('venció');
  }, 60_000);

  it('the waiting list never blocks: a free porter still receives direct calls', async () => {
    const { porter, talker } = await busyPorter('queue-no-block');
    const a = await lab.resident('queue-no-block', 'res-a', await lab.apartment('QB'), [{ platform: 'android' }]);
    const d = await lab.resident('queue-no-block', 'res-d', await lab.apartment('QB'), [{ platform: 'android' }]);
    a.device.startCall('porter', porter.user.id);
    await sleep(700);
    await talker.device.hangUp();
    await sleep(800);
    porter.device.policy = { onRing: 'answer', reactMs: [200, 200], talkMs: [800, 800] };

    d.device.startCall('porter', porter.user.id);
    await sleep(1_200);
    expect(porter.device.store.session?.initiatedByResidentId).toBe(d.user.id);
    expect((await waiting(porter.user.id)).map((row) => row.resident_id)).toEqual([a.user.id]);
    await sleep(RING_MS / 4);
  }, 60_000);

  it('a queued resident whose own call later connects leaves the queue', async () => {
    const { porter, talker } = await busyPorter('queue-self-served');
    const a = await lab.resident('queue-self-served', 'res-a', await lab.apartment('QS'), [{ platform: 'android' }]);
    a.device.startCall('porter', porter.user.id);
    await sleep(700);
    await talker.device.hangUp();
    await sleep(800);
    porter.device.policy = { onRing: 'answer', reactMs: [200, 200], talkMs: [800, 800] };
    a.device.startCall('porter', porter.user.id);
    await sleep(1_500);

    expect(await waiting(porter.user.id)).toHaveLength(0);
  }, 60_000);

  it('20 residents calling a busy porter at once get unique, consecutive positions', async () => {
    const { porter } = await busyPorter('queue-hammer');
    const apt = await lab.apartment('QH');
    const residents = await Promise.all(
      Array.from({ length: 20 }, (_, i) => lab.resident('queue-hammer', `res-${i}`, apt, [{ platform: i % 2 ? 'ios' : 'android' }])),
    );
    for (let round = 0; round < 3; round += 1) {
      await Promise.all(residents.map((res) => lab.dispatch(res.device.socket, 'calls:call-porter', { employeeId: porter.user.id })));
    }
    await sleep(1_500);

    const list = (await lab.queue.list()).filter((item) => item.employee.id === porter.user.id);
    expect(list).toHaveLength(20);
    expect(list.map((item) => item.position)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(new Set(list.map((item) => item.resident.id)).size).toBe(20);
    for (const res of residents) {
      const item = list.find((entry) => entry.resident.id === res.user.id)!;
      expect(res.device.notifications.some((n) => n.body.includes(`${item.position}.º`))).toBe(true);
    }
  }, 120_000);
});
