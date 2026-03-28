import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AdminGuard } from '../common/guards/admin.guard';
import { ResidentGuard } from '../common/guards/resident.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../common/interfaces/jwt-payload.interface';
import { AssembliesService } from './assemblies.service';
import { AssembliesGateway } from './assemblies.gateway';
import { CreateAssemblyDto } from './dto/create-assembly.dto';
import { SubmitVoteDto } from './dto/submit-vote.dto';
import { SyncVotesDto } from './dto/sync-votes.dto';

@Controller('assemblies')
export class AssembliesController {
  constructor(
    private readonly assembliesService: AssembliesService,
    private readonly assembliesGateway: AssembliesGateway,
  ) {}

  // ─── Public endpoints (no auth) ───────────────────────────────────────────

  @Get('public/:publicId')
  getPublicStats(@Param('publicId') publicId: string) {
    return this.assembliesService.getPublicStats(publicId);
  }

  @Get('public/:publicId/verify')
  verifyToken(@Param('publicId') publicId: string, @Query('token') token: string) {
    if (!token) throw new NotFoundException('Token requerido');
    return this.assembliesService.verifyToken(publicId, token);
  }

  // ─── Resident endpoints ───────────────────────────────────────────────────

  @UseGuards(JwtAuthGuard, ResidentGuard)
  @Get('active')
  getActiveAssembly() {
    return this.assembliesService.getActiveAssembly();
  }

  @UseGuards(JwtAuthGuard, ResidentGuard)
  @Get(':id/my-token')
  async getMyToken(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    const token = await this.assembliesService.getOrCreateToken(id, user.sub);
    return { token: token.token, formatted: token.token.match(/.{1,3}/g)?.join('-') ?? token.token };
  }

  @UseGuards(JwtAuthGuard, ResidentGuard)
  @Post(':id/vote')
  async submitVote(
    @Param('id') id: string,
    @Body() dto: SubmitVoteDto,
    @CurrentUser() user: JwtPayload,
  ) {
    dto.assemblyId = id;
    const { vote, stats } = await this.assembliesService.submitVote(dto, user.sub, 'online');
    this.assembliesGateway.broadcastStats(id, stats);
    return { vote: vote.vote, token: vote.verificationToken };
  }

  @UseGuards(JwtAuthGuard, ResidentGuard)
  @Post(':id/sync-votes')
  async syncVotes(
    @Param('id') id: string,
    @Body() dto: SyncVotesDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const results = await this.assembliesService.syncVotes(id, dto.votes, user.sub);
    for (const result of results) {
      if (result.accepted) {
        const stats = await this.assembliesService.computeStats(result.questionId, id);
        this.assembliesGateway.broadcastStats(id, stats);
      }
    }
    return results;
  }

  // ─── Admin endpoints ──────────────────────────────────────────────────────

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Post()
  async create(@Body() dto: CreateAssemblyDto, @CurrentUser() user: JwtPayload) {
    return this.assembliesService.create(dto, user.sub);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Get()
  findAll() {
    return this.assembliesService.findAll();
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.assembliesService.findOne(id);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Get(':id/votes')
  getVotes(@Param('id') id: string) {
    return this.assembliesService.getVotesForAssembly(id);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Post(':id/start')
  async start(@Param('id') id: string) {
    const assembly = await this.assembliesService.start(id);
    this.assembliesGateway.broadcastAssemblyStarted(id, assembly);
    const activeQuestion = assembly.questions.find((q) => q.status === 'active');
    if (activeQuestion) {
      this.assembliesGateway.broadcastQuestionOpened(id, activeQuestion);
    }
    return assembly;
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Post(':id/questions/:questionId/open')
  async openQuestion(@Param('id') id: string, @Param('questionId') questionId: string) {
    const assembly = await this.assembliesService.openQuestion(id, questionId);
    const openedQuestion = assembly.questions.find((q) => q.id === questionId);
    if (openedQuestion) {
      this.assembliesGateway.broadcastQuestionOpened(id, openedQuestion);
    }
    return assembly;
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Post(':id/questions/:questionId/close')
  async closeQuestion(@Param('id') id: string, @Param('questionId') questionId: string) {
    const assembly = await this.assembliesService.closeQuestion(id, questionId);
    const closedQuestion = assembly.questions.find((q) => q.id === questionId);
    if (closedQuestion) {
      this.assembliesGateway.broadcastQuestionClosed(id, closedQuestion);
    }
    return assembly;
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Post(':id/finish')
  async finish(@Param('id') id: string) {
    const assembly = await this.assembliesService.finish(id);
    this.assembliesGateway.broadcastFinished(id, assembly);
    return assembly;
  }
}
