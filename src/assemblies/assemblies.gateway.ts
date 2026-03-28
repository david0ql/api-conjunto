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
import { AssembliesService } from './assemblies.service';
import { SubmitVoteDto } from './dto/submit-vote.dto';
import type { AssemblyPayload, QuestionPayload, VoteStatsPayload } from './types/assembly.types';

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
export class AssembliesGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(AssembliesGateway.name);
  private readonly userBySocketId = new Map<string, JwtPayload>();
  private readonly socketsByUserKey = new Map<string, Set<string>>();

  constructor(
    private readonly assembliesService: AssembliesService,
    private readonly jwtService: JwtService,
  ) {}

  async handleConnection(client: SocketWithUser) {
    try {
      const user = this.authenticateClient(client);
      client.data.user = user;
      this.userBySocketId.set(client.id, user);
      this.registerSocket(user, client.id);
      this.logger.log(`Assembly WS connected ${client.id} (${user.type}:${user.sub})`);
    } catch {
      client.emit('assembly:error', { message: 'No fue posible autenticar el canal en tiempo real' });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: SocketWithUser) {
    const user = this.userBySocketId.get(client.id);
    if (!user) return;
    this.unregisterSocket(user, client.id);
    this.userBySocketId.delete(client.id);
  }

  @SubscribeMessage('assembly:join')
  async handleJoin(
    @ConnectedSocket() client: SocketWithUser,
    @MessageBody() body: { assemblyId?: string },
  ) {
    this.requireUser(client);
    if (!body.assemblyId) throw new WsException('assemblyId requerido');
    client.join(this.assemblyRoom(body.assemblyId));
  }

  @SubscribeMessage('assembly:vote')
  async handleVote(
    @ConnectedSocket() client: SocketWithUser,
    @MessageBody() body: SubmitVoteDto & { token?: string },
  ) {
    const user = this.requireUser(client);
    if (user.type !== 'resident') throw new WsException('Solo los residentes pueden votar');

    const { vote, stats } = await this.assembliesService.submitVote(body, user.sub, 'online');
    client.emit('assembly:vote_confirmed', {
      questionId: body.questionId,
      vote: vote.vote,
      token: vote.verificationToken,
    });

    this.server.to(this.assemblyRoom(body.assemblyId)).emit('assembly:vote_received', stats);
  }

  broadcastAssemblyStarted(assemblyId: string, payload: AssemblyPayload) {
    this.server.to(this.assemblyRoom(assemblyId)).emit('assembly:started', payload);
  }

  broadcastQuestionOpened(assemblyId: string, question: QuestionPayload) {
    this.server.to(this.assemblyRoom(assemblyId)).emit('assembly:question_opened', { assemblyId, question });
  }

  broadcastQuestionClosed(assemblyId: string, question: QuestionPayload) {
    this.server.to(this.assemblyRoom(assemblyId)).emit('assembly:question_closed', { assemblyId, question });
  }

  broadcastStats(assemblyId: string, stats: VoteStatsPayload) {
    this.server.to(this.assemblyRoom(assemblyId)).emit('assembly:vote_received', stats);
  }

  broadcastFinished(assemblyId: string, payload: AssemblyPayload) {
    this.server.to(this.assemblyRoom(assemblyId)).emit('assembly:finished', payload);
  }

  private authenticateClient(client: SocketWithUser): JwtPayload {
    const authToken = client.handshake.auth?.token;
    const headerAuth =
      typeof client.handshake.headers.authorization === 'string'
        ? client.handshake.headers.authorization
        : '';
    const bearerToken = headerAuth.startsWith('Bearer ') ? headerAuth.slice(7) : null;
    const token = authToken || bearerToken;
    if (!token) throw new WsException('Missing token');
    return this.jwtService.verify<JwtPayload>(token, {
      secret: process.env.JWT_SECRET ?? 'fallback-secret',
    });
  }

  private requireUser(client: SocketWithUser) {
    const user = client.data.user;
    if (!user) throw new WsException('Socket no autenticado');
    return user;
  }

  private registerSocket(user: JwtPayload, socketId: string) {
    const key = `${user.type}:${user.sub}`;
    const sockets = this.socketsByUserKey.get(key) ?? new Set<string>();
    sockets.add(socketId);
    this.socketsByUserKey.set(key, sockets);
  }

  private unregisterSocket(user: JwtPayload, socketId: string) {
    const key = `${user.type}:${user.sub}`;
    const sockets = this.socketsByUserKey.get(key);
    if (!sockets) return;
    sockets.delete(socketId);
    if (sockets.size === 0) this.socketsByUserKey.delete(key);
  }

  private assemblyRoom(assemblyId: string) {
    return `assembly:${assemblyId}`;
  }
}
