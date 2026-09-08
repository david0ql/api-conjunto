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

@Injectable()
export class CallsPushService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CallsPushService.name);
  private messagingClient: Messaging | null | undefined;
  private apnProviders = new Map<CallDeviceEnvironment, apn.Provider>();
  private workerInterval: NodeJS.Timeout | null = null;
  private recoveryInterval: NodeJS.Timeout | null = null;
  private workerRunning = false;

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

  async sendIncomingCall(call: CallSessionPayload) {
    const target = this.getCallTarget(call);
    if (target.userIds.length === 0) return;
    await this.enqueue(call, 'incoming');
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

  private async enqueue(call: CallSessionPayload, event: CallPushEvent) {
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
          status: 'processing',
          attempts: Number(row.attempts),
        }),
      );
    });
  }

  private async processJob(job: CallPushJob) {
    if (
      job.event === 'incoming' &&
      job.payload.expiresAt &&
      new Date(job.payload.expiresAt).getTime() <= Date.now()
    ) {
      await this.callPushJobsRepository.update(job.id, {
        status: 'failed',
        lockedAt: null,
        lastError: 'La invitación de llamada venció antes de poder enviarse',
      });
      return;
    }

    try {
      const target = this.getCallTarget(job.payload);
      if (job.channel === 'fcm') await this.sendFcm(job.payload, job.event, target);
      else if (job.channel === 'hms') await this.sendHms(job.payload, job.event, target);
      else await this.sendResidentVoip(job.payload);
      await this.callPushJobsRepository.update(job.id, {
        status: 'sent', sentAt: new Date(), lockedAt: null, lastError: null,
      });
    } catch (error) {
      const terminal = job.attempts >= 6;
      const delayMs = Math.min(60_000, 1_000 * 2 ** Math.max(0, job.attempts - 1));
      await this.callPushJobsRepository.update(job.id, {
        status: terminal ? 'failed' : 'pending',
        nextAttemptAt: new Date(Date.now() + delayMs),
        lockedAt: null,
        lastError: this.getErrorMessage(error).slice(0, 2_000),
      });
    }
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
    if (!input.targetResidentIds.length) {
      return;
    }

    const messaging = this.getMessagingClient();
    if (!messaging) {
      return;
    }

    const devices = await this.callDevicesRepository.find({
      where: {
        userType: 'resident',
        userId: In(input.targetResidentIds),
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
        result.responses.map((response) => response.error?.message ?? null),
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
  ) {
    const devices = await this.callDevicesRepository.find({
      where: {
        userType: target.userType,
        userId: In(target.userIds),
        platform: In(['android', 'ios']),
        channel: 'fcm',
        isActive: true,
      },
    });
    if (devices.length === 0) {
      await this.callsService.recordTrace(call.id, {
        source: 'api',
        stage: 'push.fcm.no_devices',
        message: `No hay dispositivos FCM activos para evento ${event}`,
        level: event === 'incoming' ? 'warn' : 'info',
        metadata: { event },
      });
      return;
    }
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

    const collapseKey =
      event === 'incoming' ? undefined : `call-state-${call.id}`;

    const message: MulticastMessage = {
      tokens: devices.map((device) => device.token),
      data: this.buildFcmData(call, event),
      android: {
        priority: 'high',
        ttl: event === 'incoming' ? 1000 * 45 : 1000 * 60,
        collapseKey,
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
      await this.handleFcmFailures(
        devices,
        result.responses.map((response) => response.error?.message ?? null),
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
          deviceCount: devices.length,
        },
      });
      if (result.failureCount > 0) {
        throw new Error(
          `FCM no entregó ${result.failureCount}/${devices.length} mensajes`,
        );
      }
    } catch (error) {
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
  ) {
    const devices = await this.callDevicesRepository.find({
      where: {
        userType: target.userType,
        userId: In(target.userIds),
        platform: 'android',
        channel: 'hms',
        isActive: true,
      },
    });
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
                ttl: event === 'incoming' ? '45s' : '60s',
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
      if (responseBody.code !== '80000000') {
        throw new Error(
          `HMS Push ${responseBody.code ?? 'respuesta inválida'}: ${responseBody.msg ?? 'sin detalle'}`,
        );
      }
      await this.callsService.recordTrace(call.id, {
        source: 'api',
        stage: 'push.hms.sent',
        message: `Push HMS ${event} enviado`,
        metadata: { event, deviceCount: devices.length },
      });
    } catch (error) {
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

  private async sendResidentVoip(call: CallSessionPayload) {
    const devices = await this.callDevicesRepository.find({
      where: {
        userType: 'resident',
        userId: In(call.targetResidentIds),
        platform: 'ios',
        channel: 'voip',
        isActive: true,
      },
    });
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

      const note = new apn.Notification();
      note.topic = `${topicBase}.voip`;
      note.priority = 10;
      note.expiry = Math.floor(Date.now() / 1000) + 60;
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
        await this.handleApnFailures(group, response.failed);
        if (response.failed.length > 0) {
          throw new Error(
            `APNs no entregó ${response.failed.length}/${group.length} mensajes`,
          );
        }
      } catch (error) {
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
    errors: Array<string | null>,
  ) {
    const toDeactivate: CallDevice[] = [];

    errors.forEach((message, index) => {
      if (!message) {
        return;
      }
      const device = devices[index];
      if (!device) {
        return;
      }

      device.lastError = message;
      if (
        message.includes('registration-token-not-registered') ||
        message.includes('Requested entity was not found') ||
        message.includes('invalid-registration-token')
      ) {
        device.isActive = false;
        toDeactivate.push(device);
      }
    });

    if (toDeactivate.length > 0) {
      await this.callDevicesRepository.save(toDeactivate);
    }
  }

  private async handleApnFailures(
    devices: CallDevice[],
    failures: Array<{
      device: string;
      status?: string;
      response?: { reason?: string };
    }>,
  ) {
    if (failures.length === 0) {
      return;
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
      if (
        ['BadDeviceToken', 'Unregistered', 'DeviceTokenNotForTopic'].includes(
          reason,
        )
      ) {
        device.isActive = false;
      }
      toUpdate.push(device);
    }

    if (toUpdate.length > 0) {
      await this.callDevicesRepository.save(toUpdate);
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
