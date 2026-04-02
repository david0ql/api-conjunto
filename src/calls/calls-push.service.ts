import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging, type Messaging, type MulticastMessage } from 'firebase-admin/messaging';
import apn from '@parse/node-apn';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { In, Repository } from 'typeorm';
import type { JwtPayload } from '../common/interfaces/jwt-payload.interface';
import type { CallSessionPayload } from './calls.types';
import { CallsService } from './calls.service';
import {
  CallDevice,
  type CallDeviceChannel,
  type CallDeviceEnvironment,
  type CallDevicePlatform,
} from './entities/call-device.entity';

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

type ResidentCallPushEvent = 'incoming' | 'accepted' | 'ended' | 'missed' | 'rejected';
interface ResidentNotificationPushInput {
  targetResidentIds: string[];
  notificationId: string;
  title: string;
  body: string;
  notificationTypeCode?: string | null;
}

@Injectable()
export class CallsPushService {
  private readonly logger = new Logger(CallsPushService.name);
  private messagingClient: Messaging | null | undefined;
  private apnProviders = new Map<CallDeviceEnvironment, apn.Provider>();

  constructor(
    @InjectRepository(CallDevice)
    private readonly callDevicesRepository: Repository<CallDevice>,
    private readonly configService: ConfigService,
    private readonly callsService: CallsService,
  ) {}

  async registerDevice(user: JwtPayload, input: RegisterCallDeviceInput) {
    const token = input.token.trim();
    if (!token) {
      return;
    }

    if (input.channel === 'voip' && input.platform !== 'ios') {
      throw new Error('Solo iOS puede registrar tokens VoIP');
    }

    const existing = await this.callDevicesRepository.findOne({ where: { token } });
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

  async unregisterDevice(user: JwtPayload, input: UnregisterCallDeviceInput = {}) {
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
    if (call.direction !== 'outbound' || call.targetResidentIds.length === 0) {
      return;
    }

    await Promise.all([
      this.sendResidentFcm(call, 'incoming'),
      this.sendResidentVoip(call),
    ]);
  }

  async sendResidentCallState(call: CallSessionPayload, event: Exclude<ResidentCallPushEvent, 'incoming'>) {
    if (call.direction !== 'outbound' || call.targetResidentIds.length === 0) {
      return;
    }

    await this.sendResidentFcm(call, event);
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
          'apns-topic': this.configService.get<string>('APNS_BUNDLE_ID', 'com.nordikhat.conjunto'),
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
      await this.handleFcmFailures(devices, result.responses.map((response) => response.error?.message ?? null));
    } catch (error) {
      this.logger.warn(`No fue posible enviar push FCM de notificación ${input.notificationId}: ${this.getErrorMessage(error)}`);
    }
  }

  private async sendResidentFcm(call: CallSessionPayload, event: ResidentCallPushEvent) {
    const messaging = this.getMessagingClient();
    if (!messaging) {
      await this.callsService.recordTrace(call.id, {
        source: 'api',
        stage: 'push.fcm.skipped',
        message: `Push FCM omitido para evento ${event} (cliente Firebase no disponible)`,
        level: event === 'incoming' ? 'warn' : 'info',
        metadata: { event },
      });
      return;
    }

    const devices = await this.callDevicesRepository.find({
      where: {
        userType: 'resident',
        userId: In(call.targetResidentIds),
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

    const collapseKey =
      event === 'incoming'
        ? undefined
        : `call-state-${call.id}`;

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
          'apns-topic': this.configService.get<string>('APNS_BUNDLE_ID', 'com.nordikhat.conjunto'),
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
      await this.handleFcmFailures(devices, result.responses.map((response) => response.error?.message ?? null));
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
    } catch (error) {
      this.logger.warn(`No fue posible enviar push FCM de llamada ${call.id}: ${this.getErrorMessage(error)}`);
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

    const topicBase = this.configService.get<string>('APNS_BUNDLE_ID', 'com.nordikhat.conjunto');
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
        continue;
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
        const response = await provider.send(note, group.map((device) => device.token));
        await this.handleApnFailures(group, response.failed);
      } catch (error) {
        this.logger.warn(`No fue posible enviar push VoIP ${environment} para llamada ${call.id}: ${this.getErrorMessage(error)}`);
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
      this.logger.warn('Firebase Admin no está configurado; se omiten pushes FCM');
      this.messagingClient = null;
      return this.messagingClient;
    }

    try {
      const credentials = JSON.parse(readFileSync(credentialsPath, 'utf8'));
      const app = getApps().find((item) => item.name === 'calls-push')
        ?? initializeApp(
          {
            credential: cert(credentials),
            projectId: this.configService.get<string>('FIREBASE_PROJECT_ID') || credentials.project_id,
          },
          'calls-push',
        );
      this.messagingClient = getMessaging(app);
      return this.messagingClient;
    } catch (error) {
      this.logger.warn(`No fue posible inicializar Firebase Admin: ${this.getErrorMessage(error)}`);
      this.messagingClient = null;
      return this.messagingClient;
    }
  }

  private getApnProvider(environment: CallDeviceEnvironment) {
    const cached = this.apnProviders.get(environment);
    if (cached) {
      return cached;
    }

    const keyPath = this.resolveCredentialsPath(this.configService.get<string>('APNS_KEY_PATH'));
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
      this.logger.warn(`No fue posible inicializar APNs ${environment}: ${this.getErrorMessage(error)}`);
      return null;
    }
  }

  private async handleFcmFailures(devices: CallDevice[], errors: Array<string | null>) {
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

  private async handleApnFailures(devices: CallDevice[], failures: Array<{ device: string; status?: string; response?: { reason?: string } }>) {
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

      const reason = failure.response?.reason ?? failure.status ?? 'unknown-apns-error';
      device.lastError = reason;
      if (['BadDeviceToken', 'Unregistered', 'DeviceTokenNotForTopic'].includes(reason)) {
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

  private getHandle(call: CallSessionPayload) {
    if (call.apartment) {
      const tower = call.apartment.tower?.name ? ` · ${call.apartment.tower.name}` : '';
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
