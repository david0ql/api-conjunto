/**
 * End-to-end chaos lab for calls (test-only, not a Jest suite by itself).
 *
 * Runs the REAL CallsGateway + CallsService + CallsPushService on a real
 * PostgreSQL, a simulated network (socket.io and push with latency, pushes
 * out of order, slow "doze" deliveries) and, on every phone, a replica of the
 * call state machine of the mobile app AS PUBLISHED (MyApp
 * src/realtime/calls/callService.ts: handleIncoming, handleAccepted,
 * handleTerminal, applyPushEvent, accept/reject/end, 'exception').
 *
 * It measures what people experience: ghost rings, double rings, a call
 * replacing another on screen, and phones stuck after the call ended.
 */
import { JwtService } from '@nestjs/jwt';
import { WsException } from '@nestjs/websockets';
import { HttpException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Apartment } from '../apartments/entities/apartment.entity';
import { SnakeCaseNamingStrategy } from '../common/strategies/snake-case.naming-strategy';
import { EmployeeRole } from '../employee-roles/entities/employee-role.entity';
import { Employee } from '../employees/entities/employee.entity';
import { ResidentApartment } from '../resident-apartments/entities/resident-apartment.entity';
import { ResidentType } from '../resident-types/entities/resident-type.entity';
import { Resident } from '../residents/entities/resident.entity';
import { Tower } from '../towers/entities/tower.entity';
import { CallsPushService } from './calls-push.service';
import { CallQueueService } from './call-queue.service';
import { CallQueueEntry } from './entities/call-queue-entry.entity';
import { Notification } from '../notifications/entities/notification.entity';
import { NotificationType } from '../notification-types/entities/notification-type.entity';
import { PushWorld, createRng, pick, randInt, type Rng } from './calls-push.simulator.testspec';
import { CallsGateway } from './calls.gateway';
import { CallsService } from './calls.service';
import type { CallSessionPayload } from './calls.types';
import { CallDevice } from './entities/call-device.entity';
import { CallPushJob, type CallPushChannel } from './entities/call-push-job.entity';
import { CallSession, type CallSessionStatus } from './entities/call-session.entity';
import { CallTraceEvent } from './entities/call-trace-event.entity';

export const LAB_ENTITIES = [
  Tower, Apartment, EmployeeRole, Employee, ResidentType, Resident, ResidentApartment,
  CallSession, CallTraceEvent, CallDevice, CallPushJob, CallQueueEntry, Notification, NotificationType,
];

export const RING_MS = 8_000;
let apartmentSequence = 0;
const GRACE_MS = 3_000;
const JWT_SECRET = process.env.JWT_SECRET ?? 'fallback-secret';

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)));

type Phase = 'idle' | 'requesting-media' | 'ringing' | 'incoming' | 'connecting' | 'active' | 'ending' | 'error';
type User = { id: string; type: 'resident' | 'employee'; role?: string; name: string };
const LIVE_PHASES: Phase[] = ['incoming', 'connecting', 'active', 'ringing'];
const TERMINAL: CallSessionStatus[] = ['ended', 'missed', 'rejected'];

export interface Finding {
  kind:
    | 'ghost-ring' // rang for a call that was no longer ringing (and it lingered)
    | 'double-ring' // rang twice for the same call
    | 'hijack' // an incoming call replaced a live call on screen
    | 'stuck' // phone not idle after everything ended
    | 'missed' // a call rang long enough but a callee phone never rang
    | 'server-state' // invalid status transition or inconsistent row
    | 'server-error'; // unexpected (non business) exception
  scenario: string;
  detail: string;
}

// ---------------------------------------------------------------------------
// Fake socket.io server
// ---------------------------------------------------------------------------

class FakeServer {
  readonly sockets = new Map<string, FakeSocket>();
  readonly rooms = new Map<string, Set<string>>();

  to(room: string) {
    return { emit: (event: string, payload: unknown) => this.broadcast(room, event, payload) };
  }

  emit() {
    // calls:porters-updated broadcast: irrelevant for ringing.
  }

  broadcast(room: string, event: string, payload: unknown, exceptId?: string) {
    for (const id of this.rooms.get(room) ?? []) {
      if (id !== exceptId) this.sockets.get(id)?.emit(event, payload);
    }
  }
}

class FakeSocket {
  readonly data: { user?: { sub: string; type: 'resident' | 'employee'; role?: string } } = {};
  readonly handshake: { auth: { token: string }; headers: Record<string, string> };
  private downlinkAt = 0;
  private uplinkAt = 0;

  constructor(
    readonly id: string,
    private readonly lab: ChaosLab,
    private readonly device: DeviceApp,
    token: string,
  ) {
    this.handshake = { auth: { token }, headers: {} };
  }

  join(room: string) {
    const members = this.lab.server.rooms.get(room) ?? new Set<string>();
    members.add(this.id);
    this.lab.server.rooms.set(room, members);
  }

  /** Server → phone, FIFO like a single websocket. */
  emit(event: string, payload: unknown) {
    const copy = JSON.parse(JSON.stringify(payload ?? null));
    this.downlinkAt = Math.max(Date.now() + this.lab.socketLatency(), this.downlinkAt + 1);
    setTimeout(() => this.device.onSocket(event, copy), this.downlinkAt - Date.now());
  }

  to(room: string) {
    return { emit: (event: string, payload: unknown) => this.lab.server.broadcast(room, event, payload, this.id) };
  }

  /** Phone → server, FIFO arrival; handlers run concurrently like Nest does. */
  send(event: string, body: Record<string, unknown>) {
    this.uplinkAt = Math.max(Date.now() + this.lab.socketLatency(), this.uplinkAt + 1);
    setTimeout(() => void this.lab.dispatch(this, event, body), this.uplinkAt - Date.now());
  }
}

// ---------------------------------------------------------------------------
// Phone running the published app logic
// ---------------------------------------------------------------------------

type Policy = { onRing: 'answer' | 'reject' | 'ignore'; reactMs: [number, number]; talkMs: [number, number] };

interface StoreSpan { callId: string | null; phase: Phase; from: number }

export class DeviceApp {
  store: { session: CallSessionPayload | null; phase: Phase } = { session: null, phase: 'idle' };
  pending: CallSessionPayload | null = null;
  readonly native = new Map<string, 'ringing' | 'active' | 'ended'>();
  readonly timeline: StoreSpan[] = [{ callId: null, phase: 'idle', from: Date.now() }];
  readonly rings: Array<{ callId: string; at: number; source: string }> = [];
  socket!: FakeSocket;
  policy: Policy = { onRing: 'answer', reactMs: [300, 1500], talkMs: [500, 2000] };
  /** false models a frozen/limited app whose POST /calls/trace never arrives. */
  sendsTraces = true;

  constructor(
    private readonly lab: ChaosLab,
    readonly name: string,
    readonly user: User,
    readonly platform: 'android' | 'ios',
    readonly tokens: Partial<Record<CallPushChannel, string>>,
    readonly scenario: string,
  ) {}

  // -- inbound events -------------------------------------------------------

  readonly socketEvents: Array<{ event: string; payload: any }> = [];

  onSocket(event: string, payload: any) {
    this.socketEvents.push({ event, payload });
    switch (event) {
      case 'calls:outgoing': return this.handleOutgoing(payload);
      case 'calls:incoming': return this.handleIncoming(payload, 'socket', true);
      case 'calls:accepted': return this.handleAccepted(payload);
      case 'calls:ended':
      case 'calls:missed':
      case 'calls:rejected': return this.handleTerminal(payload);
      case 'exception': return this.onException();
      case 'calls:error':
        this.teardown();
        return;
      default:
        return;
    }
  }

  /** General notifications shown to this person (queue turns, "next in line"). */
  readonly notifications: Array<{ title: string; body: string; at: number }> = [];

  onPush(channel: CallPushChannel, data: Record<string, unknown>) {
    if (data.kind === 'notification') {
      this.notifications.push({ title: String(data.title), body: String(data.body), at: Date.now() });
      return;
    }
    const event = String(data.event);
    let session: CallSessionPayload | null = null;
    if (typeof data.session === 'string') session = JSON.parse(data.session);
    else if (data.session && typeof data.session === 'object') session = data.session as CallSessionPayload;
    const callId = (data.callId as string) ?? session?.id ?? null;

    if (event === 'incoming') {
      if (!session) return;
      if (channel === 'voip') this.nativeShow(session.id); // AppDelegate reports to CallKit before JS
      if (!this.canHandle(session)) {
        this.pending = this.pending?.id === session.id ? null : this.pending;
        this.nativeEnd(session.id);
        return;
      }
      if (channel === 'fcm' && this.platform === 'ios') return;
      this.handleIncoming(session, channel, channel !== 'voip');
      return;
    }
    if (!callId || !session) return;
    const matchesCurrent = this.store.session?.id === callId;
    const matchesPersisted = this.pending?.id === callId;
    if (event === 'accepted') {
      if (matchesCurrent) return this.handleAccepted(session);
      if (matchesPersisted) {
        this.pending = null;
        this.nativeEnd(callId);
      }
      return;
    }
    if (matchesCurrent || matchesPersisted) this.handleTerminal(session);
  }

  private canHandle(session: CallSessionPayload) {
    if (session.direction === 'outbound') return this.user.type === 'resident' && session.targetResidentIds.includes(this.user.id);
    return this.user.type === 'employee' && session.targetEmployeeIds.includes(this.user.id);
  }

  private handleOutgoing(session: CallSessionPayload) {
    this.native.set(session.id, 'active');
    this.setStore(session, 'ringing');
  }

  private handleIncoming(session: CallSessionPayload, source: string, presentSystem: boolean) {
    const current = this.store;
    if (current.session?.id === session.id && LIVE_PHASES.includes(current.phase)) return;

    if (current.session && current.session.id !== session.id && LIVE_PHASES.includes(current.phase)) {
      const liveStatus = this.lab.statusOf(current.session.id);
      if (liveStatus === 'ringing' || liveStatus === 'active') {
        this.lab.report('hijack', this.scenario,
          `${this.name}: ${current.phase} call ${short(current.session.id)} (${liveStatus}) replaced by ${short(session.id)} (${this.lab.statusOf(session.id)}) via ${source}`);
      }
    }

    this.pending = session;
    this.setStore(session, 'incoming');
    this.rings.push({ callId: session.id, at: Date.now(), source });
    if (presentSystem) {
      this.nativeShow(session.id);
      // traceCall('mobile.incoming.system_presented') → POST /calls/trace
      this.lab.postTrace(this, session.id, 'mobile.incoming.system_presented');
    }

    if (this.policy.onRing !== 'ignore') {
      const callId = session.id;
      setTimeout(() => {
        if (this.store.session?.id !== callId || this.store.phase !== 'incoming') return;
        if (this.policy.onRing === 'answer') this.acceptCurrentCall();
        else this.rejectCurrentCall();
      }, randInt(this.lab.r, ...this.policy.reactMs));
    }
  }

  private handleAccepted(session: CallSessionPayload) {
    const current = this.store;
    if (current.session?.id === session.id && (current.phase === 'connecting' || current.phase === 'active')) return;

    if (session.direction === 'outbound') {
      if (this.user.type === 'resident' && session.acceptedByResidentId && session.acceptedByResidentId !== this.user.id) {
        this.handleTerminal({ ...session, status: 'ended', endedReason: 'answered_elsewhere' });
        return;
      }
      this.setStore(session, session.acceptedByResidentId ? 'connecting' : 'incoming');
      this.scheduleMedia(session.id);
      return;
    }
    if (session.initiatedByResidentId && session.initiatedByResidentId !== this.user.id) return;
    this.setStore(session, 'connecting');
    this.scheduleMedia(session.id);
  }

  private handleTerminal(session: CallSessionPayload) {
    const currentId = this.store.session?.id ?? null;
    if (currentId && currentId !== session.id) return;
    if (!currentId && this.pending?.id !== session.id) return;
    if (this.pending?.id === session.id) this.pending = null;
    this.nativeEnd(session.id);
    if (!currentId) return;
    this.setStore(null, 'idle');
  }

  private onException() {
    if (this.store.phase !== 'connecting' && this.store.phase !== 'incoming') return;
    const callId = this.store.session?.id;
    if (callId) {
      if (this.pending?.id === callId) this.pending = null;
      this.nativeEnd(callId);
    }
    this.setStore(null, 'idle');
  }

  // -- user actions (same guards as the app) --------------------------------

  startCall(kind: 'porter' | 'apartment' | 'employee', targetId: string) {
    if (this.store.phase !== 'idle') return false;
    this.setStore(null, 'requesting-media');
    const event = kind === 'porter' ? 'calls:call-porter' : kind === 'apartment' ? 'calls:initiate' : 'calls:initiate-porter';
    const body = kind === 'apartment' ? { apartmentId: targetId } : { employeeId: targetId };
    this.socket.send(event, body);
    return true;
  }

  acceptCurrentCall() {
    if (!this.store.session && this.pending) this.setStore(this.pending, 'incoming');
    const session = this.store.session;
    if (!session) return;
    if (this.store.phase !== 'incoming' && this.store.phase !== 'requesting-media') return;
    this.setStore(session, 'connecting');
    this.native.set(session.id, 'active');
    this.socket.send('calls:accept', { callId: session.id });
    this.scheduleMedia(session.id);
  }

  rejectCurrentCall() {
    const session = this.store.session;
    if (!session) return;
    this.setStore(session, 'ending');
    if (this.pending?.id === session.id) this.pending = null;
    this.nativeEnd(session.id);
    this.socket.send('calls:reject', { callId: session.id });
  }

  endCurrentCall() {
    const session = this.store.session;
    if (!session) return false;
    this.setStore(session, 'ending');
    if (this.pending?.id === session.id) this.pending = null;
    this.nativeEnd(session.id);
    this.socket.send('calls:end', { callId: session.id });
    return true;
  }

  /** A person keeps pressing "hang up" until the app lets them. */
  async hangUp(maxMs = 4_000) {
    const until = Date.now() + maxMs;
    while (Date.now() < until) {
      if (this.store.phase === 'idle') return;
      // Red button: on an invitation it rejects (handleSystemEnd), otherwise it hangs up.
      if (this.store.phase === 'incoming' && this.store.session) {
        this.rejectCurrentCall();
        return;
      }
      if (this.store.phase !== 'ending' && this.endCurrentCall()) return;
      await sleep(150);
    }
  }

  // -- helpers ----------------------------------------------------------------

  private scheduleMedia(callId: string) {
    setTimeout(() => {
      if (this.store.session?.id !== callId || this.store.phase !== 'connecting') return;
      if (this.lab.statusOf(callId) !== 'active') return;
      this.setStore(this.store.session, 'active');
      setTimeout(() => {
        if (this.store.session?.id === callId && this.store.phase === 'active') this.endCurrentCall();
      }, randInt(this.lab.r, ...this.policy.talkMs));
    }, randInt(this.lab.r, 150, 700));
  }

  private nativeShow(callId: string) {
    if (this.native.get(callId) !== 'ringing') this.native.set(callId, 'ringing');
  }

  private nativeEnd(callId: string) {
    if (this.native.has(callId)) this.native.set(callId, 'ended');
  }

  private teardown() {
    this.setStore(null, 'idle');
  }

  setStore(session: CallSessionPayload | null, phase: Phase) {
    this.store = { session, phase };
    this.timeline.push({ callId: session?.id ?? null, phase, from: Date.now() });
  }
}

const short = (id: string) => id.slice(0, 8);

// ---------------------------------------------------------------------------
// Lab
// ---------------------------------------------------------------------------

export class ChaosLab {
  readonly server = new FakeServer();
  readonly findings: Finding[] = [];
  readonly devices: DeviceApp[] = [];
  readonly statuses = new Map<string, Array<{ status: CallSessionStatus; at: number }>>();
  readonly callScenario = new Map<string, string>();
  readonly world: PushWorld;
  readonly r: Rng;
  gateway!: CallsGateway;
  queue!: CallQueueService;
  callsService!: CallsService;
  private pushServices: CallsPushService[] = [];
  private readonly jwt = new JwtService({ secret: JWT_SECRET });
  private reaper: NodeJS.Timeout | null = null;
  private readonly deviceByToken = new Map<string, DeviceApp>();
  private socketSeq = 0;
  private readonly userScenario = new Map<string, string>();
  private roleId = '';
  private residentTypeId = '';
  private towerId = '';

  constructor(readonly source: DataSource, seed: number) {
    this.r = createRng(seed);
    this.world = new PushWorld(this.r);
    this.world.flakyFailureRate = 0.3;
    this.world.onDelivery = (token, channel, data) => {
      const device = this.deviceByToken.get(token);
      if (device) setTimeout(() => device.onPush(channel, data), this.pushLatency());
    };
  }

  /** Forces every push to take exactly this long (deterministic late deliveries). */
  fixedPushLatencyMs: number | null = null;

  socketLatency() {
    return this.r() < 0.9 ? randInt(this.r, 5, 120) : randInt(this.r, 120, 600);
  }

  pushLatency() {
    if (this.fixedPushLatencyMs !== null) return this.fixedPushLatencyMs;
    const roll = this.r();
    if (roll < 0.7) return randInt(this.r, 80, 900);
    if (roll < 0.93) return randInt(this.r, 900, 2_500);
    return randInt(this.r, 2_500, 9_000); // doze / bad network
  }

  async start() {
    const repo = <T extends object>(entity: new () => T) => this.source.getRepository(entity);
    const config = { get: (key: string, fallback?: unknown) => fallback } as never;
    this.callsService = new CallsService(
      repo(CallSession), repo(CallTraceEvent), repo(Apartment), repo(Employee), repo(Resident), repo(ResidentApartment), config,
    );
    (this.callsService as unknown as { ringingTimeoutMs: number }).ringingTimeoutMs = RING_MS;
    this.instrumentStatuses();

    global.fetch = this.world.fetch as never;
    // Two outbox workers, like two API replicas.
    this.pushServices = [0, 1].map(() =>
      this.world.wire(new CallsPushService(repo(CallDevice), repo(CallPushJob), this.source, this.world.configService as never, this.callsService)),
    );
    for (const service of this.pushServices) await service.onModuleInit();

    this.queue = new CallQueueService(
      repo(CallQueueEntry), repo(Notification), repo(NotificationType), this.callsService, this.pushServices[0],
    );
    this.gateway = new CallsGateway(this.callsService, this.pushServices[0], this.jwt, this.queue);
    this.gateway.server = this.server as never;
    this.gateway.afterInit();
    const internalsInit = this.gateway as unknown as { reaperInterval: NodeJS.Timeout | null };
    if (internalsInit.reaperInterval) clearInterval(internalsInit.reaperInterval);
    const reconcile = (this.gateway as unknown as { reconcileExpiredCalls: () => Promise<void> }).reconcileExpiredCalls.bind(this.gateway);
    this.reaper = setInterval(() => void reconcile(), 400);

    const [role] = await this.source.query(`INSERT INTO employee_roles (code, name) VALUES ('porter', 'Portero') ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id`);
    const [type] = await this.source.query(`INSERT INTO resident_types (code, name) VALUES ('owner', 'Propietario') ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id`);
    const [tower] = await this.source.query(`INSERT INTO towers (code, name, total_floors, apartments_per_floor) VALUES ('T1', 'Torre 1', 20, 10) ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id`);
    this.roleId = role.id;
    this.residentTypeId = type.id;
    this.towerId = tower.id;
  }

  async stop() {
    if (this.reaper) clearInterval(this.reaper);
    this.pushServices.forEach((service) => service.onModuleDestroy());
    const internals = this.gateway as unknown as { timeoutByCallId: Map<string, NodeJS.Timeout>; disconnectCleanupByUserKey: Map<string, NodeJS.Timeout> };
    internals.timeoutByCallId.forEach((timeout) => clearTimeout(timeout));
    internals.disconnectCleanupByUserKey.forEach((timeout) => clearTimeout(timeout));
  }

  statusOf(callId: string): CallSessionStatus | null {
    const history = this.statuses.get(callId);
    return history?.[history.length - 1]?.status ?? null;
  }

  terminalAt(callId: string) {
    return this.statuses.get(callId)?.find((entry) => TERMINAL.includes(entry.status))?.at ?? null;
  }

  postTrace(device: DeviceApp, callId: string, stage: string) {
    if (!device.sendsTraces) return;
    setTimeout(() => {
      void this.callsService
        .createTraceForUser(callId, { sub: device.user.id, type: device.user.type }, { source: 'mobile', stage, message: stage })
        .catch(() => undefined);
    }, randInt(this.r, 40, 900));
  }

  report(kind: Finding['kind'], scenario: string, detail: string) {
    this.findings.push({ kind, scenario, detail });
  }

  // -- population ---------------------------------------------------------------

  async apartment(label: string) {
    // Unique across rounds and labs sharing the database (number is varchar(10)).
    const number = `${label.slice(0, 3)}${(++apartmentSequence).toString(36)}`.slice(0, 10);
    const [row] = await this.source.query(`INSERT INTO apartments (number, tower, tower_id, floor) VALUES ($1, 'T1', $2, 7) RETURNING id`, [number, this.towerId]);
    return row.id as string;
  }

  async porter(scenario: string, name: string, devices: Array<{ health?: 'ok' | 'flaky' }> = [{}], deadTokens = 0) {
    const [row] = await this.source.query(
      `INSERT INTO employees (name, last_name, username, password_hash, role_id) VALUES ($1, 'Lab', $2, 'x', $3) RETURNING id`,
      [name, `${name}-${this.r().toString(36).slice(2)}`, this.roleId],
    );
    const user: User = { id: row.id, type: 'employee', role: 'porter', name };
    return this.connect(scenario, user, devices.map((device) => ({ platform: 'android' as const, ...device })), deadTokens);
  }

  async resident(scenario: string, name: string, apartmentId: string, devices: Array<{ platform: 'android' | 'ios'; health?: 'ok' | 'flaky' }>, deadTokens = 0) {
    const [row] = await this.source.query(
      `INSERT INTO residents (name, last_name, document, password_hash, resident_type_id, apartment_id) VALUES ($1, 'Lab', $2, 'x', $3, $4) RETURNING id`,
      [name, `${name}-${this.r().toString(36).slice(2)}`, this.residentTypeId, apartmentId],
    );
    const user: User = { id: row.id, type: 'resident', name };
    return this.connect(scenario, user, devices, deadTokens);
  }

  private async connect(scenario: string, user: User, specs: Array<{ platform: 'android' | 'ios'; health?: 'ok' | 'flaky' }>, deadTokens: number) {
    const apps: DeviceApp[] = [];
    this.userScenario.set(user.id, scenario);
    for (const [index, spec] of specs.entries()) {
      const tokens: Partial<Record<CallPushChannel, string>> = { fcm: `fcm-${user.id}-${index}` };
      if (spec.platform === 'ios' && user.type === 'resident') tokens.voip = `voip-${user.id}-${index}`;
      const app = new DeviceApp(this, `${user.name}#${index}(${spec.platform})`, user, spec.platform, tokens, scenario);
      for (const [channel, token] of Object.entries(tokens) as Array<[CallPushChannel, string]>) {
        this.deviceByToken.set(token, app);
        this.world.behaviors.set(token, spec.health ?? 'ok');
        await this.source.query(
          `INSERT INTO call_devices (user_id, user_type, platform, channel, token, device_id, push_environment, is_active) VALUES ($1, $2, $3, $4, $5, $6, 'production', true)`,
          [user.id, user.type, spec.platform, channel, token, `phone-${user.id}-${index}`],
        );
      }
      const socket = new FakeSocket(`socket-${++this.socketSeq}`, this, app, this.jwt.sign({ sub: user.id, type: user.type, role: user.role }));
      app.socket = socket;
      this.server.sockets.set(socket.id, socket);
      await this.gateway.handleConnection(socket as never);
      this.devices.push(app);
      apps.push(app);
    }
    for (let i = 0; i < deadTokens; i += 1) {
      const token = `dead-${user.id}-${i}`;
      this.world.behaviors.set(token, 'dead');
      await this.source.query(
        `INSERT INTO call_devices (user_id, user_type, platform, channel, token, device_id, is_active) VALUES ($1, $2, 'android', 'fcm', $3, $4, true)`,
        [user.id, user.type, token, `old-phone-${user.id}-${i}`],
      );
    }
    return { user, apps, device: apps[0] };
  }

  // -- server entry point ---------------------------------------------------------

  async dispatch(socket: FakeSocket, event: string, body: Record<string, unknown>) {
    const g = this.gateway as unknown as Record<string, (client: unknown, body: unknown) => Promise<void>>;
    const handlers: Record<string, string> = {
      'calls:initiate': 'handleInitiate',
      'calls:call-porter': 'handleCallPorter',
      'calls:initiate-porter': 'handleInitiatePorter',
      'calls:accept': 'handleAccept',
      'calls:reject': 'handleReject',
      'calls:end': 'handleEnd',
    };
    try {
      await g[handlers[event]].call(this.gateway, socket, body);
    } catch (error) {
      const business = error instanceof WsException || error instanceof HttpException;
      if (!business) {
        this.report('server-error', 'server', `${event}: ${error instanceof Error ? error.stack?.split('\n').slice(0, 3).join(' | ') : String(error)}`);
      }
      // Nest turns non-WsException errors into "Internal server error".
      socket.emit('exception', { status: 'error', message: error instanceof WsException ? error.message : 'Internal server error' });
    }
  }

  private instrumentStatuses() {
    const service = this.callsService as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
    const track = (payload: unknown) => {
      const call = payload as CallSessionPayload | null;
      if (!call?.id || !call.status) return;
      if (!this.statuses.has(call.id)) {
        const participants = [call.initiatedByEmployeeId, call.initiatedByResidentId, ...call.targetResidentIds, ...call.targetEmployeeIds]
          .filter((id): id is string => Boolean(id));
        this.noteParticipants(call.id, participants);
        const owner = participants.map((id) => this.userScenario.get(id)).find(Boolean);
        if (owner) this.callScenario.set(call.id, owner);
      }
      const history = this.statuses.get(call.id) ?? [];
      const last = history[history.length - 1]?.status;
      if (last !== call.status) {
        const valid =
          !last ||
          (last === 'ringing' && call.status !== 'ringing') ||
          (last === 'active' && call.status === 'ended');
        if (!valid) this.report('server-state', this.callScenario.get(call.id) ?? '?', `call ${short(call.id)} went ${last} → ${call.status}`);
        history.push({ status: call.status, at: Date.now() });
        this.statuses.set(call.id, history);
      }
    };
    for (const method of ['createCall', 'createPorterCall', 'createInternalPorterCall', 'acceptCall', 'endCall', 'timeoutCall']) {
      const original = service[method].bind(this.callsService);
      service[method] = async (...args: unknown[]) => {
        const result = await original(...args);
        track(result);
        return result;
      };
    }
    for (const method of ['expireRingingCalls', 'endOpenCallsForActor']) {
      const original = service[method].bind(this.callsService);
      service[method] = async (...args: unknown[]) => {
        const result = (await original(...args)) as unknown[];
        result.forEach(track);
        return result;
      };
    }
    const reject = service.rejectCall.bind(this.callsService);
    service.rejectCall = async (...args: unknown[]) => {
      const result = (await reject(...args)) as { call: CallSessionPayload };
      track(result.call);
      return result;
    };
  }

  /** Waits until every call of the given users is over and the network is quiet. */
  async settle(users: string[], maxMs = 60_000) {
    const until = Date.now() + maxMs;
    for (;;) {
      const open = Array.from(this.statuses.entries()).filter(
        ([id, history]) => this.involves(id, users) && !TERMINAL.includes(history[history.length - 1].status),
      );
      if (open.length === 0 || Date.now() > until) break;
      await sleep(250);
    }
    await sleep(11_000); // slowest push (9s) + margin
  }

  private involvesCache = new Map<string, Set<string>>();
  noteParticipants(callId: string, userIds: string[]) {
    this.involvesCache.set(callId, new Set(userIds));
  }

  private involves(callId: string, users: string[]) {
    const participants = this.involvesCache.get(callId);
    return !participants || users.some((id) => participants.has(id));
  }

  // -- verdicts -------------------------------------------------------------------

  async verify(scenario: string, apps: DeviceApp[]) {
    const callIds = new Set<string>();
    for (const app of apps) {
      const end = Date.now();
      if (app.store.phase !== 'idle') {
        this.report('stuck', scenario, `${app.name} ended in ${app.store.phase} on ${app.store.session ? short(app.store.session.id) : 'no session'} (${app.store.session ? this.statusOf(app.store.session.id) : '-'})`);
      }
      for (const [callId, state] of app.native) {
        if (state !== 'ended' && this.statusOf(callId) !== 'active') {
          this.report('stuck', scenario, `${app.name} native call ${short(callId)} still ${state} (server ${this.statusOf(callId)})`);
        }
      }

      const perCall = new Map<string, number>();
      for (const ring of app.rings) {
        callIds.add(ring.callId);
        perCall.set(ring.callId, (perCall.get(ring.callId) ?? 0) + 1);
      }
      for (const [callId, count] of perCall) {
        if (count > 1) this.report('double-ring', scenario, `${app.name} rang ${count} times for ${short(callId)}`);
      }

      // A ghost ring: the phone shows an invitation longer than GRACE after the call stopped ringing.
      app.timeline.forEach((span, index) => {
        if (span.phase !== 'incoming' || !span.callId) return;
        const until = app.timeline[index + 1]?.from ?? end;
        const stoppedRinging = this.statuses.get(span.callId)?.find((entry) => entry.status !== 'ringing')?.at;
        if (stoppedRinging === undefined) return;
        const lingering = until - Math.max(span.from, stoppedRinging);
        if (lingering > GRACE_MS) {
          this.report('ghost-ring', scenario, `${app.name} showed ${short(span.callId)} as incoming for ${lingering}ms after it became ${this.statusOf(span.callId)}`);
        }
      });
    }

    // Every callee phone that was free must ring for a call that rang ≥ 2.5s.
    for (const [callId, history] of this.statuses) {
      if (this.callScenario.get(callId) !== scenario) continue;
      const stopped = history.find((entry) => entry.status !== 'ringing')?.at ?? Date.now();
      if (stopped - history[0].at < 2_500) continue;
      const rows = await this.source.query(`SELECT target_resident_ids, target_employee_ids FROM call_sessions WHERE id = $1`, [callId]);
      const targets: string[] = [...JSON.parse(rows[0].target_resident_ids ?? '[]'), ...JSON.parse(rows[0].target_employee_ids ?? '[]')];
      for (const app of apps.filter((item) => targets.includes(item.user.id))) {
        const busyAtStart = app.timeline.filter((span) => span.from <= history[0].at).pop();
        if (busyAtStart && busyAtStart.phase !== 'idle') continue;
        if (!app.rings.some((ring) => ring.callId === callId)) {
          this.report('missed', scenario, `${app.name} never rang for ${short(callId)} that rang ${stopped - history[0].at}ms`);
        }
      }
    }

    // Database consistency for this scenario's calls.
    const ids = Array.from(this.statuses.keys()).filter((id) => this.callScenario.get(id) === scenario);
    if (ids.length > 0) {
      const rows = await this.source.query(
        `SELECT id, status, accepted_at, ended_at, accepted_by_resident_id, accepted_by_employee_id FROM call_sessions WHERE id = ANY($1)`,
        [ids],
      );
      for (const row of rows) {
        if (row.status === 'active' || row.status === 'ringing') this.report('server-state', scenario, `call ${short(row.id)} left ${row.status}`);
        if (TERMINAL.includes(row.status) && !row.ended_at) this.report('server-state', scenario, `call ${short(row.id)} ${row.status} without ended_at`);
        if (row.status === 'rejected' && (row.accepted_by_resident_id || row.accepted_by_employee_id)) {
          this.report('server-state', scenario, `call ${short(row.id)} was accepted but ended as rejected`);
        }
      }
    }
  }
}
