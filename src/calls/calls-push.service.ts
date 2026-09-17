import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import {
  getMessaging,
  type Messaging,
  type MulticastMessage,
} from 'firebase-admin/messaging';
import apn from '@parse/node-apn';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DataSource, In, Repository } from 'typeorm';
import type { JwtPayload } from '../common/interfaces/jwt-payload.interface';
import type { CallSessionPayload } from './calls.types';
import { CallsService } from './calls.service';
import {
  CallDevice,
  type CallDeviceChannel,
  type CallDeviceEnvironment,
  type CallDevicePlatform,
} from './entities/call-device.entity';
import {
  CallPushJob,
  type CallPushChannel,
  type CallPushEvent,
} from './entities/call-push-job.entity';

export interface RegisterCallDeviceInput {
  token: string;
  platform: CallDevicePlatform;
  channel: CallDeviceChannel;
  environment?: CallDeviceEnvironment | null;
  deviceId?: string | null;
  appVersion?: string | null;
}

export interface UnregisterCallDeviceInput {
  token?: string;
  platform?: CallDevicePlatform;
  channel?: CallDeviceChannel;
  deviceId?: string | null;
}

type ResidentCallPushEvent = CallPushEvent;
interface ResidentNotificationPushInput {
  targetResidentIds: string[];
  notificationId: string;
  title: string;
  body: string;
  notificationTypeCode?: string | null;
}

/** The call stopped ringing (answered, rejected, ended or expired). */
export class CallInvitationClosedError extends Error {}

@Injectable()
export class CallsPushService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CallsPushService.name);
  private messagingClient: Messaging | null | undefined;
  private apnProviders = new Map<CallDeviceEnvironment, apn.Provider>();
  private workerInterval: NodeJS.Timeout | null = null;
  private recoveryInterval: NodeJS.Timeout | null = null;
  private workerRunning = false;

  private static readonly DEFAULT_INCOMING_TTL_MS = 45_000;
  private static readonly SOCKET_ACK_WINDOW_MS = 2_500;
  private static readonly MIN_INCOMING_TTL_MS = 1_000;
  private static readonly PERMANENT_FCM_ERROR_CODES = new Set([
    'messaging/registration-token-not-registered',
    'messaging/invalid-registration-token',
    'messaging/invalid-recipient',
    'messaging/mismatched-credential',
  ]);
  private static readonly PERMANENT_APNS_REASONS = new Set([
    'BadDeviceToken',
    'Unregistered',
    'DeviceTokenNotForTopic',
  ]);

  constructor(
    @InjectRepository(CallDevice)
    private readonly callDevicesRepository: Repository<CallDevice>,
    @InjectRepository(CallPushJob)
    private readonly callPushJobsRepository: Repository<CallPushJob>,
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
    private readonly callsService: CallsService,
  ) {}

  async onModuleInit() {
    await this.recoverAbandonedJobs();
    void this.processPendingJobs();
    this.workerInterval = setInterval(() => void this.processPendingJobs(), 1_000);
    this.workerInterval.unref();
    this.recoveryInterval = setInterval(() => void this.recoverAbandonedJobs(), 30_000);
    this.recoveryInterval.unref();
  }

  onModuleDestroy() {
    if (this.workerInterval) clearInterval(this.workerInterval);
    if (this.recoveryInterval) clearInterval(this.recoveryInterval);
  }

  async registerDevice(user: JwtPayload, input: RegisterCallDeviceInput) {
    const token = input.token.trim();
    if (!token) {
      return;
    }

    if (input.channel === 'voip' && input.platform !== 'ios') {
      throw new Error('Solo iOS puede registrar tokens VoIP');
    }

    await this.deactivateDeviceRegistrationsForOtherUsers(user, input.deviceId);

    const existing = await this.callDevicesRepository.findOne({
      where: { token },
    });
    const device = existing ?? this.callDevicesRepository.create();
    device.userId = user.sub;
    device.userType = user.type;
    device.token = token;
    device.platform = input.platform;
    device.channel = input.channel;
    device.pushEnvironment = input.environment ?? null;
    device.deviceId = input.deviceId?.trim() || null;
    device.appVersion = input.appVersion?.trim() || null;
    device.isActive = true;
    device.lastSeenAt = new Date();
    device.lastError = null;
    await this.callDevicesRepository.save(device);
    await this.deactivateReplacedTokens(device);
  }

  /**
   * A physical device keeps one live token per channel. When it registers a
   * new one (token refresh, reinstall), older tokens for that device stop
   * receiving pushes so the same phone can never ring twice for one call.
   */
  private async deactivateReplacedTokens(device: CallDevice) {
    if (!device.deviceId) {
      return;
    }

    await this.callDevicesRepository
      .createQueryBuilder()
      .update(CallDevice)
      .set({ isActive: false, lastSeenAt: new Date() })
      .where('device_id = :deviceId', { deviceId: device.deviceId })
      .andWhere('channel = :channel', { channel: device.channel })
      .andWhere('token <> :token', { token: device.token })
      .andWhere('is_active = true')
      .execute();
  }

  private async deactivateDeviceRegistrationsForOtherUsers(
    user: JwtPayload,
    deviceId?: string | null,
  ) {
    const normalizedDeviceId = deviceId?.trim();
    if (!normalizedDeviceId) {
      return;
    }

    await this.callDevicesRepository
      .createQueryBuilder()
      .update(CallDevice)
      .set({
        isActive: false,
        lastSeenAt: new Date(),
      })
      .where('device_id = :deviceId', { deviceId: normalizedDeviceId })
      .andWhere('is_active = true')
      .andWhere('NOT (user_id = :userId AND user_type = :userType)', {
        userId: user.sub,
        userType: user.type,
      })
      .execute();
  }

  async unregisterDevice(
    user: JwtPayload,
    input: UnregisterCallDeviceInput = {},
  ) {
    const where: Record<string, unknown> = {
      userId: user.sub,
      userType: user.type,
    };

    if (input.token?.trim()) {
      where.token = input.token.trim();
    }
    if (input.platform) {
      where.platform = input.platform;
    }
    if (input.channel) {
      where.channel = input.channel;
    }
    if (input.deviceId?.trim()) {
      where.deviceId = input.deviceId.trim();
    }

    const matches = await this.callDevicesRepository.find({ where });
    if (matches.length === 0) {
      return;
    }

    matches.forEach((device) => {
      device.isActive = false;
      device.lastSeenAt = new Date();
    });
    await this.callDevicesRepository.save(matches);
  }

  async sendResidentIncomingCall(call: CallSessionPayload) {
    return this.sendIncomingCall(call);
  }

  /**
   * `socketUserIds`: targets that already got the invitation through an open
   * socket. Their push waits SOCKET_ACK_WINDOW_MS and is skipped if their
   * phone confirmed it is showing the call; otherwise a late push could ring
   * again after the call ended (the app does not remember finished calls).
   */
  async sendIncomingCall(
    call: CallSessionPayload,
    options: { socketUserIds?: string[] } = {},
  ) {
    const target = this.getCallTarget(call);
    if (target.userIds.length === 0) return;
    const socketUserIds = (options.socketUserIds ?? []).filter((id) =>
      target.userIds.includes(id),
    );
    await this.enqueue(call, 'incoming', socketUserIds);
  }

  async sendResidentCallState(
    call: CallSessionPayload,
    event: Exclude<ResidentCallPushEvent, 'incoming'>,
  ) {
    return this.sendCallState(call, event);
  }

  async sendCallState(
    call: CallSessionPayload,
    event: Exclude<ResidentCallPushEvent, 'incoming'>,
  ) {
    const target = this.getCallTarget(call);
    if (target.userIds.length === 0) return;
    await this.enqueue(call, event);
  }

  private async enqueue(
    call: CallSessionPayload,
    event: CallPushEvent,
    deferredUserIds: string[] = [],
  ) {
    const target = this.getCallTarget(call);
    const channels: CallPushChannel[] = ['fcm', 'hms'];
    if (event === 'incoming' && target.userType === 'resident') channels.push('voip');
    await this.callPushJobsRepository
      .createQueryBuilder()
      .insert()
      .into(CallPushJob)
      .values(channels.map((channel) => ({
        callSessionId: call.id,
        event,
        channel,
        payload: call as never,
        deferredUserIds: deferredUserIds.length > 0 ? deferredUserIds : null,
        status: 'pending',
        attempts: 0,
        nextAttemptAt: new Date(),
      })))
      .orIgnore()
      .execute();
    void this.processPendingJobs();
  }

  private async processPendingJobs() {
    if (this.workerRunning) return;
    this.workerRunning = true;
    try {
      const jobs = await this.claimJobs(10);
      for (const job of jobs) await this.processJob(job);
    } catch (error) {
      this.logger.error(`Falló el procesador de outbox: ${this.getErrorMessage(error)}`);
    } finally {
      this.workerRunning = false;
    }
  }

  private async claimJobs(limit: number): Promise<CallPushJob[]> {
    return this.dataSource.transaction(async (manager) => {
      const queryResult: unknown = await manager.query(
        `WITH candidates AS (
           SELECT id FROM call_push_jobs
           WHERE status = 'pending' AND next_attempt_at <= NOW()
           ORDER BY next_attempt_at, created_at
           FOR UPDATE SKIP LOCKED
           LIMIT $1
         )
         UPDATE call_push_jobs jobs
         SET status = 'processing', locked_at = NOW(), attempts = jobs.attempts + 1, updated_at = NOW()
         FROM candidates
         WHERE jobs.id = candidates.id
         RETURNING
           jobs.id AS "id",
           jobs.call_session_id AS "callSessionId",
           jobs.event AS "event",
           jobs.channel AS "channel",
           jobs.payload AS "payload",
           jobs.delivered_tokens AS "deliveredTokens",
           jobs.deferred_user_ids AS "deferredUserIds",
           jobs.created_at AS "createdAt",
           jobs.attempts AS "attempts"`,
        [limit],
      );
      // TypeORM/Postgres can return either the rows directly or
      // [rows, affectedCount], depending on the query-runner version.
      const rows = Array.isArray(queryResult) && Array.isArray(queryResult[0])
        ? queryResult[0]
        : queryResult;
      if (!Array.isArray(rows)) return [];
      return rows.map((row: Record<string, unknown>) =>
        this.callPushJobsRepository.create({
          id: row.id as string,
          callSessionId: row.callSessionId as string,
          event: row.event as CallPushEvent,
          channel: row.channel as CallPushChannel,
          payload:
            typeof row.payload === 'string'
              ? (JSON.parse(row.payload) as CallSessionPayload)
              : (row.payload as CallSessionPayload),
          deliveredTokens:
            typeof row.deliveredTokens === 'string'
              ? (JSON.parse(row.deliveredTokens) as string[])
              : null,
          deferredUserIds:
            typeof row.deferredUserIds === 'string'
              ? (JSON.parse(row.deferredUserIds) as string[])
              : null,
          createdAt: new Date(row.createdAt as string | Date),
          status: 'processing',
          attempts: Number(row.attempts),
        }),
      );
    });
  }

  private async processJob(job: CallPushJob) {
    const delivered = new Set(job.deliveredTokens ?? []);
    try {
      // Cheap early exit; the same gate runs again right before each network
      // send so the window between "still ringing" and "sent" stays minimal.
      await this.getIncomingTtlMs(job.payload, job.event);

      const { skipUserIds, resumeAt } = await this.resolveSocketAcks(job);
      const baseTarget = this.getCallTarget(job.payload);
      const target = {
        ...baseTarget,
        userIds: baseTarget.userIds.filter((id) => !skipUserIds.has(id)),
      };
      if (target.userIds.length > 0) {
        if (job.channel === 'fcm') await this.sendFcm(job.payload, job.event, target, delivered);
        else if (job.channel === 'hms') await this.sendHms(job.payload, job.event, target, delivered);
        else await this.sendResidentVoip(job.payload, delivered, target.userIds);
      }

      if (resumeAt) {
        // Users without a socket were served now; the rest after the window.
        // Waiting is not a failed attempt, so the retry budget is kept.
        await this.callPushJobsRepository.update(job.id, {
          status: 'pending', nextAttemptAt: resumeAt, lockedAt: null,
          attempts: Math.max(0, job.attempts - 1), lastError: null,
          deliveredTokens: Array.from(delivered),
        });
        return;
      }
      await this.callPushJobsRepository.update(job.id, {
        status: 'sent', sentAt: new Date(), lockedAt: null, lastError: null,
        deliveredTokens: Array.from(delivered),
      });
    } catch (error) {
      // An invitation for a call that stopped ringing is never retried: that
      // retry is exactly what made phones ring again after answering.
      const terminal = error instanceof CallInvitationClosedError || job.attempts >= 6;
      const delayMs = Math.min(60_000, 1_000 * 2 ** Math.max(0, job.attempts - 1));
      await this.callPushJobsRepository.update(job.id, {
        status: terminal ? 'failed' : 'pending',
        nextAttemptAt: new Date(Date.now() + delayMs),
        lockedAt: null,
        lastError: this.getErrorMessage(error).slice(0, 2_000),
        deliveredTokens: Array.from(delivered),
      });
    }
  }

  private async resolveSocketAcks(job: CallPushJob): Promise<{
    skipUserIds: Set<string>;
    resumeAt: Date | null;
  }> {
    const deferred = job.event === 'incoming' ? (job.deferredUserIds ?? []) : [];
    if (deferred.length === 0) {
      return { skipUserIds: new Set(), resumeAt: null };
    }
    const ackDeadline =
      job.createdAt.getTime() + CallsPushService.SOCKET_ACK_WINDOW_MS;
    if (Date.now() < ackDeadline) {
      return { skipUserIds: new Set(deferred), resumeAt: new Date(ackDeadline) };
    }
    const showing = await this.callsService.getUsersShowingIncomingCall(
      job.callSessionId,
      deferred,
    );
    return { skipUserIds: showing, resumeAt: null };
  }

  /**
   * For an `incoming` push, returns how long the invitation may still live
   * (used as the push TTL so a late delivery can never ring an expired call).
   * Throws CallInvitationClosedError once the call is no longer ringing.
   * State events (accepted/ended/...) are always deliverable and return null.
   */
  private async getIncomingTtlMs(
    call: CallSessionPayload,
    event: CallPushEvent,
  ): Promise<number | null> {
    if (event !== 'incoming') return null;

    const remainingMs = call.expiresAt
      ? new Date(call.expiresAt).getTime() - Date.now()
      : CallsPushService.DEFAULT_INCOMING_TTL_MS;
    if (remainingMs < CallsPushService.MIN_INCOMING_TTL_MS) {
      throw new CallInvitationClosedError(
        'La invitación de llamada venció antes de poder enviarse',
      );
    }

    const status = await this.callsService.getCallStatus(call.id);
    if (status !== 'ringing') {
      throw new CallInvitationClosedError(
        `La llamada ya no está timbrando (${status ?? 'no existe'})`,
      );
    }
    return Math.min(remainingMs, CallsPushService.DEFAULT_INCOMING_TTL_MS);
  }

  /** Active devices that have not received this push yet, one per token. */
  private pendingDevices(devices: CallDevice[], delivered: Set<string>) {
    const byToken = new Map<string, CallDevice>();
    for (const device of devices) {
      if (!delivered.has(device.token) && !byToken.has(device.token)) {
        byToken.set(device.token, device);
      }
    }
    return Array.from(byToken.values());
  }

  private async recoverAbandonedJobs() {
    await this.callPushJobsRepository
      .createQueryBuilder()
      .update(CallPushJob)
      .set({ status: 'pending', lockedAt: null, nextAttemptAt: new Date() })
      .where("status = 'processing'")
      .andWhere("locked_at < NOW() - INTERVAL '2 minutes'")
      .execute();
  }

  async sendResidentNotification(input: ResidentNotificationPushInput) {
    return this.sendUserNotification({
      userType: 'resident',
      userIds: input.targetResidentIds,
      notificationId: input.notificationId,
      title: input.title,
      body: input.body,
      notificationTypeCode: input.notificationTypeCode,
    });
  }

  /** Plain notification (shown by the system; the app shows it in foreground on iOS). */
  async sendUserNotification(input: {
    userType: JwtPayload['type'];
    userIds: string[];
    notificationId: string;
    title: string;
    body: string;
    notificationTypeCode?: string | null;
  }) {
    if (!input.userIds.length) {
      return;
    }

    const messaging = this.getMessagingClient();
    if (!messaging) {
      return;
    }

    const devices = await this.callDevicesRepository.find({
      where: {
        userType: input.userType,
        userId: In(input.userIds),
        platform: In(['android', 'ios']),
        channel: 'fcm',
        isActive: true,
      },
    });
    if (devices.length === 0) {
      return;
    }

    const message: MulticastMessage = {
      tokens: devices.map((device) => device.token),
      notification: {
        title: input.title,
        body: input.body,
      },
      data: {
        kind: 'notification',
        event: 'new_notification',
        notificationId: input.notificationId,
        notificationType: input.notificationTypeCode ?? '',
        title: input.title,
        body: input.body,
        timestamp: new Date().toISOString(),
      },
      android: {
        priority: 'high',
        ttl: 1000 * 60 * 10,
      },
      apns: {
        headers: {
          'apns-priority': '10',
          'apns-push-type': 'alert',
          'apns-topic': this.configService.get<string>(
            'APNS_BUNDLE_ID',
            'com.nordikhat.conjunto',
          ),
        },
        payload: {
          aps: {
            sound: 'default',
          },
        },
      },
    };

    try {
      const result = await messaging.sendEachForMulticast(message);
      await this.handleFcmFailures(
        devices,
        result.responses.map((response) => response.error ?? null),
      );
    } catch (error) {
      this.logger.warn(
        `No fue posible enviar push FCM de notificación ${input.notificationId}: ${this.getErrorMessage(error)}`,
      );
    }
  }

  private async sendFcm(
    call: CallSessionPayload,
    event: ResidentCallPushEvent,
    target: { userType: JwtPayload['type']; userIds: string[] },
    delivered: Set<string> = new Set(),
  ) {
    const allDevices = await this.callDevicesRepository.find({
      where: {
        userType: target.userType,
        userId: In(target.userIds),
        platform: In(['android', 'ios']),
        channel: 'fcm',
        isActive: true,
      },
    });
    if (allDevices.length === 0) {
      await this.callsService.recordTrace(call.id, {
        source: 'api',
        stage: 'push.fcm.no_devices',
        message: `No hay dispositivos FCM activos para evento ${event}`,
        level: event === 'incoming' ? 'warn' : 'info',
        metadata: { event },
      });
      return;
    }
    const devices = this.pendingDevices(allDevices, delivered);
    if (devices.length === 0) return;

    const messaging = this.getMessagingClient();
    if (!messaging) {
      await this.callsService.recordTrace(call.id, {
        source: 'api',
        stage: 'push.fcm.skipped',
        message: `Push FCM omitido para evento ${event} (cliente Firebase no disponible)`,
        level: event === 'incoming' ? 'warn' : 'info',
        metadata: { event },
      });
      throw new Error('Firebase Admin no está configurado');
    }

    const incomingTtlMs = await this.getIncomingTtlMs(call, event);

    // Invitation and state events share one collapse key: a device that was
    // offline only gets the latest one (e.g. "ended"), never a stale invite.
    const message: MulticastMessage = {
      tokens: devices.map((device) => device.token),
      data: this.buildFcmData(call, event),
      android: {
        priority: 'high',
        ttl: incomingTtlMs ?? 1000 * 60,
        collapseKey: `call-${call.id}`,
        directBootOk: true,
      },
      apns: {
        headers: {
          'apns-priority': event === 'incoming' ? '10' : '5',
          'apns-push-type': event === 'incoming' ? 'background' : 'background',
          'apns-topic': this.configService.get<string>(
            'APNS_BUNDLE_ID',
            'com.nordikhat.conjunto',
          ),
        },
        payload: {
          aps: {
            contentAvailable: true,
          },
        },
      },
    };

    try {
      const result = await messaging.sendEachForMulticast(message);
      result.responses.forEach((response, index) => {
        if (response.success) delivered.add(devices[index].token);
      });
      const { retryable } = await this.handleFcmFailures(
        devices,
        result.responses.map((response) => response.error ?? null),
      );
      await this.callsService.recordTrace(call.id, {
        source: 'api',
        stage: 'push.fcm.sent',
        message: `Push FCM ${event}: ${result.successCount}/${devices.length} entregados`,
        level: result.failureCount > 0 ? 'warn' : 'info',
        metadata: {
          event,
          successCount: result.successCount,
          failureCount: result.failureCount,
          retryableCount: retryable,
          deviceCount: devices.length,
        },
      });
      // Dead tokens are deactivated above and must not trigger a retry;
      // only transient errors are worth another attempt.
      if (retryable > 0) {
        throw new Error(
          `FCM no entregó ${retryable}/${devices.length} mensajes (error transitorio)`,
        );
      }
    } catch (error) {
      if (error instanceof CallInvitationClosedError) throw error;
      this.logger.warn(
        `No fue posible enviar push FCM de llamada ${call.id}: ${this.getErrorMessage(error)}`,
      );
      await this.callsService.recordTrace(call.id, {
        source: 'api',
        stage: 'push.fcm.error',
        message: `Falló envío FCM para evento ${event}`,
        level: 'error',
        metadata: {
          event,
          error: this.getErrorMessage(error),
          deviceCount: devices.length,
        },
      });
      throw error;
    }
  }

  private async sendHms(
    call: CallSessionPayload,
    event: ResidentCallPushEvent,
    target: { userType: JwtPayload['type']; userIds: string[] },
    delivered: Set<string> = new Set(),
  ) {
    const allDevices = await this.callDevicesRepository.find({
      where: {
        userType: target.userType,
        userId: In(target.userIds),
        platform: 'android',
        channel: 'hms',
        isActive: true,
      },
    });
    const devices = this.pendingDevices(allDevices, delivered);
    if (devices.length === 0) return;

    const clientId = this.configService.get<string>('HMS_CLIENT_ID');
    const clientSecret = this.configService.get<string>('HMS_CLIENT_SECRET');
    const appId = this.configService.get<string>('HMS_APP_ID') ?? clientId;
    if (!clientId || !clientSecret || !appId) {
      await this.callsService.recordTrace(call.id, {
        source: 'api',
        stage: 'push.hms.skipped',
        message: `Push HMS omitido para evento ${event} (credenciales no configuradas)`,
        level: event === 'incoming' ? 'warn' : 'info',
        metadata: { event, deviceCount: devices.length },
      });
      throw new Error('HMS Push no está configurado');
    }

    try {
      const tokenResponse = await fetch(
        'https://oauth-login.cloud.huawei.com/oauth2/v3/token',
        {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: clientId,
            client_secret: clientSecret,
          }),
        },
      );
      if (!tokenResponse.ok)
        throw new Error(`HMS OAuth HTTP ${tokenResponse.status}`);
      const tokenBody = (await tokenResponse.json()) as {
        access_token?: string;
      };
      if (!tokenBody.access_token)
        throw new Error('HMS OAuth no devolvió access_token');

      const incomingTtlMs = await this.getIncomingTtlMs(call, event);

      const response = await fetch(
        `https://push-api.cloud.huawei.com/v1/${appId}/messages:send`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${tokenBody.access_token}`,
            'content-type': 'application/json; charset=UTF-8',
          },
          body: JSON.stringify({
            validate_only: false,
            message: {
              token: devices.map((device) => device.token),
              data: JSON.stringify(this.buildFcmData(call, event)),
              android: {
                urgency: event === 'incoming' ? 'HIGH' : 'NORMAL',
                ttl: incomingTtlMs === null
                  ? '60s'
                  : `${Math.max(1, Math.floor(incomingTtlMs / 1000))}s`,
              },
            },
          }),
        },
      );
      if (!response.ok) throw new Error(`HMS Push HTTP ${response.status}`);
      const responseBody = (await response.json()) as {
        code?: string;
        msg?: string;
      };
      // 80100000 = partial success: the rest were illegal tokens, which are
      // permanent, so deactivate them instead of re-sending to everyone.
      if (responseBody.code === '80100000') {
        const illegal = new Set(this.parseHmsIllegalTokens(responseBody.msg));
        const dead = devices.filter((device) => illegal.has(device.token));
        dead.forEach((device) => {
          device.isActive = false;
          device.lastError = 'HMS illegal token';
        });
        if (dead.length > 0) await this.callDevicesRepository.save(dead);
      } else if (responseBody.code !== '80000000') {
        throw new Error(
          `HMS Push ${responseBody.code ?? 'respuesta inválida'}: ${responseBody.msg ?? 'sin detalle'}`,
        );
      }
      devices.forEach((device) => {
        if (device.isActive) delivered.add(device.token);
      });
      await this.callsService.recordTrace(call.id, {
        source: 'api',
        stage: 'push.hms.sent',
        message: `Push HMS ${event} enviado`,
        metadata: { event, deviceCount: devices.length },
      });
    } catch (error) {
      if (error instanceof CallInvitationClosedError) throw error;
      await this.callsService.recordTrace(call.id, {
        source: 'api',
        stage: 'push.hms.error',
        message: `Falló envío HMS para evento ${event}`,
        level: 'error',
        metadata: {
          event,
          error: this.getErrorMessage(error),
          deviceCount: devices.length,
        },
      });
      throw error;
    }
  }

  private async sendResidentVoip(
    call: CallSessionPayload,
    delivered: Set<string> = new Set(),
    residentIds: string[] = call.targetResidentIds,
  ) {
    const allDevices = await this.callDevicesRepository.find({
      where: {
        userType: 'resident',
        userId: In(residentIds),
        platform: 'ios',
        channel: 'voip',
        isActive: true,
      },
    });
    const devices = this.pendingDevices(allDevices, delivered);
    if (devices.length === 0) {
      return;
    }

    const topicBase = this.configService.get<string>(
      'APNS_BUNDLE_ID',
      'com.nordikhat.conjunto',
    );
    const byEnvironment = new Map<CallDeviceEnvironment, CallDevice[]>();
    for (const device of devices) {
      const environment = device.pushEnvironment ?? 'development';
      const list = byEnvironment.get(environment) ?? [];
      list.push(device);
      byEnvironment.set(environment, list);
    }

    for (const [environment, group] of byEnvironment.entries()) {
      const provider = this.getApnProvider(environment);
      if (!provider) {
        throw new Error(`APNs ${environment} no está configurado`);
      }

      const incomingTtlMs = (await this.getIncomingTtlMs(call, 'incoming')) ?? 0;
      const note = new apn.Notification();
      note.topic = `${topicBase}.voip`;
      note.priority = 10;
      // iOS must ring for every VoIP push it receives, so APNs has to drop it
      // once the invitation expired instead of delivering it late.
      note.expiry = Math.floor((Date.now() + incomingTtlMs) / 1000);
      note.collapseId = `call-${call.id}`;
      note.contentAvailable = true;
      note.pushType = 'voip';
      note.payload = {
        kind: 'call',
        event: 'incoming',
        callId: call.id,
        uuid: call.id,
        callerName: this.getCallerName(call),
        handle: this.getHandle(call),
        session: call,
      };

      try {
        const response = await provider.send(
          note,
          group.map((device) => device.token),
        );
        response.sent.forEach((sent) => delivered.add(sent.device));
        const { retryable } = await this.handleApnFailures(
          group,
          response.failed,
        );
        if (retryable > 0) {
          throw new Error(
            `APNs no entregó ${retryable}/${group.length} mensajes (error transitorio)`,
          );
        }
      } catch (error) {
        if (error instanceof CallInvitationClosedError) throw error;
        this.logger.warn(
          `No fue posible enviar push VoIP ${environment} para llamada ${call.id}: ${this.getErrorMessage(error)}`,
        );
        throw error;
      }
    }
  }

  private buildFcmData(call: CallSessionPayload, event: ResidentCallPushEvent) {
    return {
      kind: 'call',
      event,
      callId: call.id,
      session: JSON.stringify(call),
      callerName: this.getCallerName(call),
      handle: this.getHandle(call),
      timestamp: new Date().toISOString(),
    };
  }

  private getMessagingClient() {
    if (this.messagingClient !== undefined) {
      return this.messagingClient;
    }

    const credentialsPath = this.resolveCredentialsPath(
      this.configService.get<string>('FIREBASE_ADMIN_CREDENTIALS_PATH'),
    );
    if (!credentialsPath || !existsSync(credentialsPath)) {
      this.logger.warn(
        'Firebase Admin no está configurado; se omiten pushes FCM',
      );
      this.messagingClient = null;
      return this.messagingClient;
    }

    try {
      const credentials = JSON.parse(readFileSync(credentialsPath, 'utf8'));
      const app =
        getApps().find((item) => item.name === 'calls-push') ??
        initializeApp(
          {
            credential: cert(credentials),
            projectId:
              this.configService.get<string>('FIREBASE_PROJECT_ID') ||
              credentials.project_id,
          },
          'calls-push',
        );
      this.messagingClient = getMessaging(app);
      return this.messagingClient;
    } catch (error) {
      this.logger.warn(
        `No fue posible inicializar Firebase Admin: ${this.getErrorMessage(error)}`,
      );
      this.messagingClient = null;
      return this.messagingClient;
    }
  }

  private getApnProvider(environment: CallDeviceEnvironment) {
    const cached = this.apnProviders.get(environment);
    if (cached) {
      return cached;
    }

    const keyPath = this.resolveCredentialsPath(
      this.configService.get<string>('APNS_KEY_PATH'),
    );
    const keyId = this.configService.get<string>('APNS_KEY_ID');
    const teamId = this.configService.get<string>('APNS_TEAM_ID');
    if (!keyPath || !existsSync(keyPath) || !keyId || !teamId) {
      this.logger.warn('APNs no está configurado; se omiten pushes VoIP');
      return null;
    }

    try {
      const provider = new apn.Provider({
        token: {
          key: keyPath,
          keyId,
          teamId,
        },
        production: environment === 'production',
      });
      this.apnProviders.set(environment, provider);
      return provider;
    } catch (error) {
      this.logger.warn(
        `No fue posible inicializar APNs ${environment}: ${this.getErrorMessage(error)}`,
      );
      return null;
    }
  }

  private async handleFcmFailures(
    devices: CallDevice[],
    errors: Array<{ code?: string; message?: string } | null>,
  ) {
    const toUpdate: CallDevice[] = [];
    let retryable = 0;

    errors.forEach((error, index) => {
      const device = devices[index];
      if (!error || !device) {
        return;
      }

      // firebase-admin puts the stable identifier in `code`; the message is
      // often just "NotRegistered", so matching on it let dead tokens pile up.
      const code = error.code ?? '';
      const message = error.message ?? code;
      device.lastError = `${code} ${message}`.trim().slice(0, 500);
      if (
        CallsPushService.PERMANENT_FCM_ERROR_CODES.has(code) ||
        message.includes('registration-token-not-registered') ||
        message.includes('Requested entity was not found') ||
        message.includes('NotRegistered') ||
        message.includes('invalid-registration-token')
      ) {
        device.isActive = false;
      } else {
        retryable += 1;
      }
      toUpdate.push(device);
    });

    if (toUpdate.length > 0) {
      await this.callDevicesRepository.save(toUpdate);
    }
    return { retryable };
  }

  private async handleApnFailures(
    devices: CallDevice[],
    failures: Array<{
      device: string;
      status?: string;
      response?: { reason?: string };
    }>,
  ) {
    let retryable = 0;
    if (failures.length === 0) {
      return { retryable };
    }

    const byToken = new Map(devices.map((device) => [device.token, device]));
    const toUpdate: CallDevice[] = [];

    for (const failure of failures) {
      const device = byToken.get(failure.device);
      if (!device) {
        continue;
      }

      const reason =
        failure.response?.reason ?? failure.status ?? 'unknown-apns-error';
      device.lastError = reason;
      if (CallsPushService.PERMANENT_APNS_REASONS.has(reason)) {
        device.isActive = false;
      } else {
        retryable += 1;
      }
      toUpdate.push(device);
    }

    if (toUpdate.length > 0) {
      await this.callDevicesRepository.save(toUpdate);
    }
    return { retryable };
  }

  private parseHmsIllegalTokens(msg?: string): string[] {
    try {
      const parsed = JSON.parse(msg ?? '') as { illegal_tokens?: unknown };
      return Array.isArray(parsed.illegal_tokens)
        ? parsed.illegal_tokens.filter((t): t is string => typeof t === 'string')
        : [];
    } catch {
      return [];
    }
  }

  private getCallerName(call: CallSessionPayload) {
    if (call.initiatedByEmployee) {
      return `${call.initiatedByEmployee.name} ${call.initiatedByEmployee.lastName}`.trim();
    }
    return 'Portería';
  }

  private getCallTarget(call: CallSessionPayload): {
    userType: JwtPayload['type'];
    userIds: string[];
  } {
    return call.direction === 'outbound'
      ? { userType: 'resident', userIds: call.targetResidentIds }
      : { userType: 'employee', userIds: call.targetEmployeeIds };
  }

  private getHandle(call: CallSessionPayload) {
    if (call.apartment) {
      const tower = call.apartment.tower?.name
        ? ` · ${call.apartment.tower.name}`
        : '';
      return `Apartamento ${call.apartment.number}${tower}`;
    }
    return 'Portería';
  }

  private resolveCredentialsPath(pathValue?: string | null) {
    if (!pathValue) {
      return null;
    }

    if (pathValue.startsWith('/')) {
      return pathValue;
    }

    return resolve(process.cwd(), pathValue);
  }

  private getErrorMessage(error: unknown) {
    if (error instanceof Error) {
      return error.message;
    }
    return 'Unknown error';
  }
}
