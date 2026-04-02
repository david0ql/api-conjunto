import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { Logger, UsePipes, ValidationPipe } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import type { JwtPayload } from '../common/interfaces/jwt-payload.interface';
import type { CallSignalEnvelope } from './calls.types';
import { CallsPushService } from './calls-push.service';
import { CallsService } from './calls.service';

type SocketWithUser = Socket & { data: { user?: JwtPayload } };

@WebSocketGateway({
  cors: {
    origin: true,
    credentials: false,
  },
})
@UsePipes(
  new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: false,
  }),
)
export class CallsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(CallsGateway.name);
  private readonly socketsByUserKey = new Map<string, Set<string>>();
  private readonly userBySocketId = new Map<string, JwtPayload>();
  private readonly timeoutByCallId = new Map<string, NodeJS.Timeout>();
  private readonly disconnectCleanupByUserKey = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly callsService: CallsService,
    private readonly callsPushService: CallsPushService,
    private readonly jwtService: JwtService,
  ) {}

  async handleConnection(client: SocketWithUser) {
    try {
      const user = this.authenticateClient(client);
      client.data.user = user;
      this.userBySocketId.set(client.id, user);
      this.registerSocket(user, client.id);
      this.clearDisconnectCleanupForUser(user);

      client.join(this.userRoom(user));
      if (user.type === 'resident') {
        const apartmentIds = await this.callsService.getApartmentIdsForResident(user.sub);
        apartmentIds.forEach((apartmentId) => client.join(this.apartmentRoom(apartmentId)));
      }

      this.logger.log(`Realtime client connected ${client.id} (${user.type}:${user.sub})`);
    } catch (error) {
      this.logger.warn(`Rejected socket ${client.id}: ${this.getErrorMessage(error)}`);
      client.emit('calls:error', { message: 'No fue posible autenticar el canal en tiempo real' });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: SocketWithUser) {
    const user = this.userBySocketId.get(client.id);
    if (!user) {
      return;
    }

    this.unregisterSocket(user, client.id);
    this.userBySocketId.delete(client.id);

    if (!this.hasAnyActiveSocketForUser(user)) {
      this.scheduleDisconnectCleanupForUser(user);
    }
  }

  @SubscribeMessage('calls:initiate')
  async handleInitiate(
    @ConnectedSocket() client: SocketWithUser,
    @MessageBody() body: { apartmentId?: string },
  ) {
    const user = this.requireUser(client);
    if (user.type !== 'employee' || !['administrator', 'porter', 'pool_attendant'].includes(user.role ?? '')) {
      throw new WsException('Solo administradores, porteria y piscina pueden iniciar llamadas');
    }
    if (!body.apartmentId) {
      throw new WsException('apartmentId is required');
    }

    const call = await this.callsService.createCall({
      apartmentId: body.apartmentId,
      initiatedByEmployeeId: user.sub,
    });
    void this.callsService.recordTrace(call.id, {
      source: 'api',
      stage: 'call.created',
      message: 'Llamada saliente creada desde web',
      actorUserId: user.sub,
      actorUserType: user.type,
      metadata: { direction: call.direction, apartmentId: call.apartmentId },
    }).catch(() => undefined);

    this.server.in(this.userRoom(user)).socketsJoin(this.callRoom(call.id));
    this.server.to(this.userRoom(user)).emit('calls:outgoing', call);
    (call.targetResidentIds ?? []).forEach((residentId) => {
      this.server.to(this.userRoom({ sub: residentId, type: 'resident' })).emit('calls:incoming', call);
    });
    await this.callsPushService.sendResidentIncomingCall(call);
    await this.emitPorterAvailability();
    this.setTimeoutForCall(call.id);
  }

  @SubscribeMessage('calls:call-porter')
  async handleCallPorter(
    @ConnectedSocket() client: SocketWithUser,
    @MessageBody() body: { employeeId?: string },
  ) {
    const user = this.requireUser(client);
    if (user.type !== 'resident') {
      throw new WsException('Solo residentes pueden llamar a porteria');
    }
    if (!body.employeeId) {
      throw new WsException('employeeId is required');
    }

    const call = await this.callsService.createPorterCall(user.sub, body.employeeId);
    void this.callsService.recordTrace(call.id, {
      source: 'api',
      stage: 'call.created',
      message: 'Llamada residente -> portería creada',
      actorUserId: user.sub,
      actorUserType: user.type,
      metadata: { direction: call.direction },
    }).catch(() => undefined);

    this.server.in(this.userRoom(user)).socketsJoin(this.callRoom(call.id));
    this.server.to(this.userRoom(user)).emit('calls:outgoing', call);
    (call.targetEmployeeIds ?? []).forEach((employeeId) => {
      this.server.to(this.userRoom({ sub: employeeId, type: 'employee' })).emit('calls:incoming', call);
    });
    await this.emitPorterAvailability();
    this.setTimeoutForCall(call.id);
  }

  @SubscribeMessage('calls:initiate-porter')
  async handleInitiatePorter(
    @ConnectedSocket() client: SocketWithUser,
    @MessageBody() body: { employeeId?: string },
  ) {
    const user = this.requireUser(client);
    if (user.type !== 'employee' || user.role !== 'porter') {
      throw new WsException('Solo porteria puede iniciar llamadas internas');
    }
    if (!body.employeeId) {
      throw new WsException('employeeId is required');
    }

    const call = await this.callsService.createInternalPorterCall({
      initiatedByEmployeeId: user.sub,
      targetEmployeeId: body.employeeId,
    });
    void this.callsService.recordTrace(call.id, {
      source: 'api',
      stage: 'call.created',
      message: 'Llamada interna de portería creada',
      actorUserId: user.sub,
      actorUserType: user.type,
      metadata: { direction: call.direction },
    }).catch(() => undefined);

    this.server.in(this.userRoom(user)).socketsJoin(this.callRoom(call.id));
    this.server.to(this.userRoom(user)).emit('calls:outgoing', call);
    (call.targetEmployeeIds ?? []).forEach((employeeId) => {
      this.server.to(this.userRoom({ sub: employeeId, type: 'employee' })).emit('calls:incoming', call);
    });
    await this.emitPorterAvailability();
    this.setTimeoutForCall(call.id);
  }

  @SubscribeMessage('calls:accept')
  async handleAccept(
    @ConnectedSocket() client: SocketWithUser,
    @MessageBody() body: { callId?: string },
  ) {
    const user = this.requireUser(client);
    if (!body.callId) {
      throw new WsException('callId is required');
    }

    const call = await this.callsService.acceptCall(body.callId, { id: user.sub, type: user.type });
    this.clearTimeoutForCall(call.id);
    void this.callsService.recordTrace(call.id, {
      source: 'api',
      stage: 'call.accepted',
      message: 'Llamada aceptada',
      actorUserId: user.sub,
      actorUserType: user.type,
      metadata: { direction: call.direction },
    }).catch(() => undefined);

    this.server.in(this.userRoom(user)).socketsJoin(this.callRoom(call.id));

    if (call.direction === 'outbound') {
      // Employee (initiator) joins call room
      if (call.initiatedByEmployeeId) {
        this.server
          .in(this.userRoom({ sub: call.initiatedByEmployeeId, type: 'employee' }))
          .socketsJoin(this.callRoom(call.id));
      }
      this.server.to(this.callRoom(call.id)).emit('calls:accepted', call);
      await this.callsPushService.sendResidentCallState(call, 'accepted');
      // Notify other residents in the apartment
      (call.targetResidentIds ?? [])
        .filter((residentId) => residentId !== user.sub)
        .forEach((residentId) => {
          this.server
            .to(this.userRoom({ sub: residentId, type: 'resident' }))
            .emit('calls:accepted', call);
        });
    } else if (call.direction === 'inbound') {
      // Inbound: employee (porter) accepted, notify the initiating resident
      if (call.initiatedByResidentId) {
        this.server
          .in(this.userRoom({ sub: call.initiatedByResidentId, type: 'resident' }))
          .socketsJoin(this.callRoom(call.id));
      }
      this.server.to(this.callRoom(call.id)).emit('calls:accepted', call);
      // Notify other porters that someone answered
      (call.targetEmployeeIds ?? [])
        .filter((employeeId) => employeeId !== user.sub)
        .forEach((employeeId) => {
          this.server
            .to(this.userRoom({ sub: employeeId, type: 'employee' }))
            .emit('calls:accepted', call);
        });
    } else {
      if (call.initiatedByEmployeeId) {
        this.server
          .in(this.userRoom({ sub: call.initiatedByEmployeeId, type: 'employee' }))
          .socketsJoin(this.callRoom(call.id));
      }
      this.server.to(this.callRoom(call.id)).emit('calls:accepted', call);
    }
    await this.emitPorterAvailability();
  }

  @SubscribeMessage('calls:reject')
  async handleReject(
    @ConnectedSocket() client: SocketWithUser,
    @MessageBody() body: { callId?: string },
  ) {
    const user = this.requireUser(client);
    if (!body.callId) {
      throw new WsException('callId is required');
    }

    const result = await this.callsService.rejectCall(body.callId, { id: user.sub, type: user.type });

    if (!result.terminal) {
      void this.callsService.recordTrace(result.call.id, {
        source: 'api',
        stage: 'call.rejected.partial',
        message: 'Un participante rechazó la llamada',
        actorUserId: user.sub,
        actorUserType: user.type,
        metadata: { direction: result.call.direction },
      }).catch(() => undefined);
      if (result.call.direction === 'outbound' && result.call.initiatedByEmployeeId) {
        this.server
          .to(this.userRoom({ sub: result.call.initiatedByEmployeeId, type: 'employee' }))
          .emit('calls:resident-rejected', {
            callId: result.call.id,
            residentId: user.sub,
            rejectedResidentIds: result.call.rejectedResidentIds,
          });
      } else if (result.call.direction === 'inbound' && result.call.initiatedByResidentId) {
        this.server
          .to(this.userRoom({ sub: result.call.initiatedByResidentId, type: 'resident' }))
          .emit('calls:porter-rejected', {
            callId: result.call.id,
            employeeId: user.sub,
            rejectedEmployeeIds: result.call.rejectedEmployeeIds,
          });
      } else if (result.call.direction === 'internal' && result.call.initiatedByEmployeeId) {
        this.server
          .to(this.userRoom({ sub: result.call.initiatedByEmployeeId, type: 'employee' }))
          .emit('calls:employee-rejected', {
            callId: result.call.id,
            employeeId: user.sub,
            rejectedEmployeeIds: result.call.rejectedEmployeeIds,
          });
      }
      await this.emitPorterAvailability();
      return;
    }

    this.clearTimeoutForCall(result.call.id);
    void this.callsService.recordTrace(result.call.id, {
      source: 'api',
      stage: 'call.rejected',
      message: 'Llamada rechazada y cerrada',
      actorUserId: user.sub,
      actorUserType: user.type,
      metadata: { direction: result.call.direction },
    }).catch(() => undefined);
    this.emitCallTerminalState('calls:rejected', result.call);
    await this.callsPushService.sendResidentCallState(result.call, 'rejected');
    await this.emitPorterAvailability();
  }

  @SubscribeMessage('calls:end')
  async handleEnd(
    @ConnectedSocket() client: SocketWithUser,
    @MessageBody() body: { callId?: string; reason?: string },
  ) {
    const user = this.requireUser(client);
    if (!body.callId) {
      throw new WsException('callId is required');
    }

    const call = await this.callsService.endCall(
      body.callId,
      { id: user.sub, type: user.type },
      body.reason,
    );
    this.clearTimeoutForCall(call.id);
    void this.callsService.recordTrace(call.id, {
      source: 'api',
      stage: 'call.ended',
      message: 'Llamada finalizada por participante',
      actorUserId: user.sub,
      actorUserType: user.type,
      metadata: { reason: body.reason ?? null, direction: call.direction },
    }).catch(() => undefined);
    this.emitCallTerminalState('calls:ended', call);
    await this.callsPushService.sendResidentCallState(call, 'ended');
    await this.emitPorterAvailability();
  }

  @SubscribeMessage('calls:signal')
  async handleSignal(
    @ConnectedSocket() client: SocketWithUser,
    @MessageBody() body: { callId?: string; signal?: CallSignalEnvelope },
  ) {
    const user = this.requireUser(client);
    if (!body.callId || !body.signal) {
      throw new WsException('callId and signal are required');
    }

    const call = await this.callsService.ensureCanSignal(body.callId, user);
    if (!call) {
      return;
    }

    const targetUser = this.callsService.getSignalTarget(call, user);
    if (!targetUser) {
      throw new WsException('No hay un participante disponible para recibir la señal');
    }

    if (body.signal.type !== 'ice-candidate') {
      void this.callsService.recordTrace(call.id, {
        source: 'api',
        stage: `signal.${body.signal.type}.forwarded`,
        message: `Señal ${body.signal.type} reenviada`,
        actorUserId: user.sub,
        actorUserType: user.type,
        metadata: {
          fromUserType: user.type,
          toUserType: targetUser.type,
        },
      }).catch(() => undefined);
    }

    this.server.to(this.userRoom(targetUser)).emit('calls:signal', {
      callId: call.id,
      from: {
        userId: user.sub,
        type: user.type,
      },
      signal: body.signal,
    });
  }

  @SubscribeMessage('calls:request-offer')
  async handleRequestOffer(
    @ConnectedSocket() client: SocketWithUser,
    @MessageBody() body: { callId?: string },
  ) {
    const user = this.requireUser(client);
    if (!body.callId) {
      throw new WsException('callId is required');
    }

    const call = await this.callsService.ensureCanSignal(body.callId, user);
    if (!call) {
      return;
    }

    const targetUser = this.callsService.getSignalTarget(call, user);
    if (!targetUser) {
      throw new WsException('No hay un participante disponible para reenviar la oferta');
    }

    void this.callsService.recordTrace(call.id, {
      source: 'api',
      stage: 'signal.offer.retry_requested',
      message: 'Se solicitó reintento de oferta WebRTC',
      actorUserId: user.sub,
      actorUserType: user.type,
      metadata: {
        fromUserType: user.type,
        toUserType: targetUser.type,
      },
    }).catch(() => undefined);

    this.server.to(this.userRoom(targetUser)).emit('calls:request-offer', {
      callId: call.id,
      requestedBy: {
        userId: user.sub,
        type: user.type,
      },
    });
  }

  private authenticateClient(client: SocketWithUser): JwtPayload {
    const authToken = client.handshake.auth?.token;
    const headerAuth =
      typeof client.handshake.headers.authorization === 'string'
        ? client.handshake.headers.authorization
        : '';
    const bearerToken = headerAuth.startsWith('Bearer ') ? headerAuth.slice(7) : null;
    const token = authToken || bearerToken;
    if (!token) {
      throw new WsException('Missing token');
    }

    return this.jwtService.verify<JwtPayload>(token, {
      secret: process.env.JWT_SECRET ?? 'fallback-secret',
    });
  }

  private registerSocket(user: JwtPayload, socketId: string) {
    const key = this.userKey(user);
    const sockets = this.socketsByUserKey.get(key) ?? new Set<string>();
    sockets.add(socketId);
    this.socketsByUserKey.set(key, sockets);
  }

  private hasAnyActiveSocketForUser(user: Pick<JwtPayload, 'sub' | 'type'>) {
    const sockets = this.socketsByUserKey.get(this.userKey(user));
    return Boolean(sockets && sockets.size > 0);
  }

  private scheduleDisconnectCleanupForUser(user: JwtPayload) {
    const key = this.userKey(user);
    this.clearDisconnectCleanupForUser(user);

    const timeout = setTimeout(() => {
      void this.cleanupDisconnectedUserCalls(user);
    }, 8_000);

    this.disconnectCleanupByUserKey.set(key, timeout);
  }

  private clearDisconnectCleanupForUser(user: Pick<JwtPayload, 'sub' | 'type'>) {
    const key = this.userKey(user);
    const timeout = this.disconnectCleanupByUserKey.get(key);
    if (!timeout) {
      return;
    }
    clearTimeout(timeout);
    this.disconnectCleanupByUserKey.delete(key);
  }

  private async cleanupDisconnectedUserCalls(user: JwtPayload) {
    this.disconnectCleanupByUserKey.delete(this.userKey(user));
    if (this.hasAnyActiveSocketForUser(user)) {
      return;
    }

    const endedCalls = await this.callsService.endOpenCallsForActor({
      id: user.sub,
      type: user.type,
    }, 'socket_disconnect');

    if (endedCalls.length === 0) {
      return;
    }

    for (const call of endedCalls) {
      this.clearTimeoutForCall(call.id);
      this.emitCallTerminalState('calls:ended', call);
      await this.callsPushService.sendResidentCallState(call, 'ended');
      void this.callsService.recordTrace(call.id, {
        source: 'api',
        stage: 'call.ended.disconnect_cleanup',
        message: 'Llamada cerrada por desconexión del participante',
        actorUserId: user.sub,
        actorUserType: user.type,
        metadata: {
          reason: 'socket_disconnect',
          direction: call.direction,
        },
      }).catch(() => undefined);
    }

    await this.emitPorterAvailability();
  }

  private unregisterSocket(user: JwtPayload, socketId: string) {
    const key = this.userKey(user);
    const sockets = this.socketsByUserKey.get(key);
    if (!sockets) {
      return;
    }
    sockets.delete(socketId);
    if (sockets.size === 0) {
      this.socketsByUserKey.delete(key);
    }
  }

  private requireUser(client: SocketWithUser) {
    const user = client.data.user;
    if (!user) {
      throw new WsException('Unauthenticated socket');
    }
    return user;
  }

  private emitCallTerminalState(
    eventName: 'calls:ended' | 'calls:missed' | 'calls:rejected',
    call: Awaited<ReturnType<CallsService['getPayload']>>,
  ) {
    this.server.to(this.callRoom(call.id)).emit(eventName, call);

    if (call.direction === 'outbound') {
      if (call.initiatedByEmployeeId) {
        this.server
          .to(this.userRoom({ sub: call.initiatedByEmployeeId, type: 'employee' }))
          .emit(eventName, call);
      }
      (call.targetResidentIds ?? []).forEach((residentId) => {
        this.server
          .to(this.userRoom({ sub: residentId, type: 'resident' }))
          .emit(eventName, call);
      });
    } else if (call.direction === 'inbound') {
      if (call.initiatedByResidentId) {
        this.server
          .to(this.userRoom({ sub: call.initiatedByResidentId, type: 'resident' }))
          .emit(eventName, call);
      }
      (call.targetEmployeeIds ?? []).forEach((employeeId) => {
        this.server
          .to(this.userRoom({ sub: employeeId, type: 'employee' }))
          .emit(eventName, call);
      });
    } else {
      if (call.initiatedByEmployeeId) {
        this.server
          .to(this.userRoom({ sub: call.initiatedByEmployeeId, type: 'employee' }))
          .emit(eventName, call);
      }
      (call.targetEmployeeIds ?? []).forEach((employeeId) => {
        this.server
          .to(this.userRoom({ sub: employeeId, type: 'employee' }))
          .emit(eventName, call);
      });
    }
  }

  private setTimeoutForCall(callId: string) {
    this.clearTimeoutForCall(callId);
    const timeout = setTimeout(async () => {
      try {
        const call = await this.callsService.timeoutCall(callId);
        if (!call) {
          return;
        }
        void this.callsService.recordTrace(call.id, {
          source: 'api',
          stage: 'call.missed.timeout',
          message: 'Llamada cerrada por timeout',
          metadata: { direction: call.direction },
        }).catch(() => undefined);
        this.emitCallTerminalState('calls:missed', call);
        await this.callsPushService.sendResidentCallState(call, 'missed');
        await this.emitPorterAvailability();
      } finally {
        this.timeoutByCallId.delete(callId);
      }
    }, 45_000);

    this.timeoutByCallId.set(callId, timeout);
  }

  private clearTimeoutForCall(callId: string) {
    const timeout = this.timeoutByCallId.get(callId);
    if (timeout) {
      clearTimeout(timeout);
      this.timeoutByCallId.delete(callId);
    }
  }

  private apartmentRoom(apartmentId: string) {
    return `apartment:${apartmentId}`;
  }

  private callRoom(callId: string) {
    return `call:${callId}`;
  }

  private userRoom(user: Pick<JwtPayload, 'sub' | 'type'>) {
    return `${user.type}:${user.sub}`;
  }

  private async emitPorterAvailability() {
    const porters = await this.callsService.getPorters();
    this.server.emit('calls:porters-updated', porters);
  }

  private userKey(user: Pick<JwtPayload, 'sub' | 'type'>) {
    return this.userRoom(user);
  }

  private getErrorMessage(error: unknown) {
    if (error instanceof Error) {
      return error.message;
    }
    return 'Unknown error';
  }
}
