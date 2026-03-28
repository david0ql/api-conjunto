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

  constructor(
    private readonly callsService: CallsService,
    private readonly jwtService: JwtService,
  ) {}

  async handleConnection(client: SocketWithUser) {
    try {
      const user = this.authenticateClient(client);
      client.data.user = user;
      this.userBySocketId.set(client.id, user);
      this.registerSocket(user, client.id);

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
  }

  @SubscribeMessage('calls:initiate')
  async handleInitiate(
    @ConnectedSocket() client: SocketWithUser,
    @MessageBody() body: { apartmentId?: string },
  ) {
    const user = this.requireUser(client);
    if (user.type !== 'employee' || !['administrator', 'porter'].includes(user.role ?? '')) {
      throw new WsException('Solo administradores y porteria pueden iniciar llamadas');
    }
    if (!body.apartmentId) {
      throw new WsException('apartmentId is required');
    }

    const call = await this.callsService.createCall({
      apartmentId: body.apartmentId,
      initiatedByEmployeeId: user.sub,
    });

    this.server.in(this.userRoom(user)).socketsJoin(this.callRoom(call.id));
    this.server.to(this.userRoom(user)).emit('calls:outgoing', call);
    (call.targetResidentIds ?? []).forEach((residentId) => {
      this.server.to(this.userRoom({ sub: residentId, type: 'resident' })).emit('calls:incoming', call);
    });
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

    this.server.in(this.userRoom(user)).socketsJoin(this.callRoom(call.id));
    this.server.to(this.userRoom(user)).emit('calls:outgoing', call);
    (call.targetEmployeeIds ?? []).forEach((employeeId) => {
      this.server.to(this.userRoom({ sub: employeeId, type: 'employee' })).emit('calls:incoming', call);
    });
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

    this.server.in(this.userRoom(user)).socketsJoin(this.callRoom(call.id));

    if (call.direction === 'outbound') {
      // Employee (initiator) joins call room
      if (call.initiatedByEmployeeId) {
        this.server
          .in(this.userRoom({ sub: call.initiatedByEmployeeId, type: 'employee' }))
          .socketsJoin(this.callRoom(call.id));
      }
      this.server.to(this.callRoom(call.id)).emit('calls:accepted', call);
      // Notify other residents in the apartment
      (call.targetResidentIds ?? [])
        .filter((residentId) => residentId !== user.sub)
        .forEach((residentId) => {
          this.server
            .to(this.userRoom({ sub: residentId, type: 'resident' }))
            .emit('calls:accepted', call);
        });
    } else {
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
    }
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
      }
      return;
    }

    this.clearTimeoutForCall(result.call.id);
    this.emitCallTerminalState('calls:rejected', result.call);
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
    this.emitCallTerminalState('calls:ended', call);
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

    this.server.to(this.userRoom(targetUser)).emit('calls:signal', {
      callId: call.id,
      from: {
        userId: user.sub,
        type: user.type,
      },
      signal: body.signal,
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
    } else {
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
        this.emitCallTerminalState('calls:missed', call);
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
