import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import * as crypto from 'crypto';
import { Assembly } from './entities/assembly.entity';
import { AssemblyQuestion } from './entities/assembly-question.entity';
import { AssemblyVote } from './entities/assembly-vote.entity';
import { AssemblyResidentToken } from './entities/assembly-resident-token.entity';
import { Resident } from '../residents/entities/resident.entity';
import { CreateAssemblyDto } from './dto/create-assembly.dto';
import { SubmitVoteDto } from './dto/submit-vote.dto';
import type {
  AssemblyPayload,
  PublicStatsPayload,
  QuestionPayload,
  QuestionStats,
  VoteStatsPayload,
  VoteSyncResult,
} from './types/assembly.types';

@Injectable()
export class AssembliesService {
  constructor(
    @InjectRepository(Assembly)
    private readonly assembliesRepository: Repository<Assembly>,
    @InjectRepository(AssemblyQuestion)
    private readonly questionsRepository: Repository<AssemblyQuestion>,
    @InjectRepository(AssemblyVote)
    private readonly votesRepository: Repository<AssemblyVote>,
    @InjectRepository(AssemblyResidentToken)
    private readonly tokensRepository: Repository<AssemblyResidentToken>,
    @InjectRepository(Resident)
    private readonly residentsRepository: Repository<Resident>,
  ) {}

  async create(dto: CreateAssemblyDto, employeeId: string): Promise<AssemblyPayload> {
    const assembly = this.assembliesRepository.create({
      title: dto.title,
      description: dto.description ?? null,
      scheduledDate: dto.scheduledDate,
      status: 'draft',
      createdByEmployeeId: employeeId,
    });

    const saved = await this.assembliesRepository.save(assembly);

    const questions = dto.questions.map((q) =>
      this.questionsRepository.create({
        assemblyId: saved.id,
        text: q.text,
        order: q.order,
        status: 'pending',
      }),
    );
    await this.questionsRepository.save(questions);

    return this.buildPayload(saved.id);
  }

  async findAll(): Promise<AssemblyPayload[]> {
    const assemblies = await this.assembliesRepository.find({
      order: { createdAt: 'DESC' },
    });

    return Promise.all(assemblies.map((a) => this.buildPayload(a.id)));
  }

  async findOne(id: string): Promise<AssemblyPayload> {
    return this.buildPayload(id);
  }

  async start(id: string): Promise<AssemblyPayload> {
    const assembly = await this.assembliesRepository.findOne({ where: { id } });
    if (!assembly) throw new NotFoundException(`Asamblea #${id} no encontrada`);
    if (assembly.status !== 'draft') throw new ConflictException('La asamblea ya fue iniciada');

    const today = new Date().toISOString().slice(0, 10);
    if (assembly.scheduledDate > today) {
      throw new BadRequestException(
        `La asamblea está programada para ${assembly.scheduledDate}. Debe reprogramarse para iniciarla hoy.`,
      );
    }

    const questions = await this.questionsRepository.find({
      where: { assemblyId: id },
      order: { order: 'ASC' },
    });
    if (questions.length === 0) {
      throw new BadRequestException('La asamblea debe tener al menos una pregunta');
    }

    assembly.status = 'active';
    assembly.startedAt = new Date();
    await this.assembliesRepository.save(assembly);

    const firstQuestion = questions[0];
    firstQuestion.status = 'active';
    firstQuestion.activatedAt = new Date();
    await this.questionsRepository.save(firstQuestion);

    return this.buildPayload(id);
  }

  async openQuestion(assemblyId: string, questionId: string): Promise<AssemblyPayload> {
    const assembly = await this.assembliesRepository.findOne({ where: { id: assemblyId } });
    if (!assembly) throw new NotFoundException(`Asamblea #${assemblyId} no encontrada`);
    if (assembly.status !== 'active') throw new BadRequestException('La asamblea no está activa');

    const active = await this.questionsRepository.findOne({
      where: { assemblyId, status: 'active' },
    });
    if (active) throw new ConflictException('Ya hay una pregunta activa. Ciérrela primero.');

    const question = await this.questionsRepository.findOne({ where: { id: questionId, assemblyId } });
    if (!question) throw new NotFoundException(`Pregunta #${questionId} no encontrada`);
    if (question.status !== 'pending') throw new ConflictException('La pregunta ya fue activada');

    question.status = 'active';
    question.activatedAt = new Date();
    await this.questionsRepository.save(question);

    return this.buildPayload(assemblyId);
  }

  async closeQuestion(assemblyId: string, questionId: string): Promise<AssemblyPayload> {
    const question = await this.questionsRepository.findOne({ where: { id: questionId, assemblyId } });
    if (!question) throw new NotFoundException(`Pregunta #${questionId} no encontrada`);
    if (question.status !== 'active') throw new ConflictException('La pregunta no está activa');

    question.status = 'closed';
    question.closedAt = new Date();
    await this.questionsRepository.save(question);

    return this.buildPayload(assemblyId);
  }

  async finish(assemblyId: string): Promise<AssemblyPayload> {
    const assembly = await this.assembliesRepository.findOne({ where: { id: assemblyId } });
    if (!assembly) throw new NotFoundException(`Asamblea #${assemblyId} no encontrada`);
    if (assembly.status !== 'active') throw new BadRequestException('La asamblea no está activa');

    const activeQuestion = await this.questionsRepository.findOne({
      where: { assemblyId, status: 'active' },
    });
    if (activeQuestion) {
      activeQuestion.status = 'closed';
      activeQuestion.closedAt = new Date();
      await this.questionsRepository.save(activeQuestion);
    }

    assembly.status = 'finished';
    assembly.finishedAt = new Date();
    await this.assembliesRepository.save(assembly);

    return this.buildPayload(assemblyId);
  }

  async getActiveAssembly(): Promise<AssemblyPayload | null> {
    const assembly = await this.assembliesRepository.findOne({
      where: { status: 'active' },
    });
    if (!assembly) return null;
    return this.buildPayload(assembly.id);
  }

  async submitVote(
    dto: SubmitVoteDto,
    residentId: string,
    source: 'online' | 'offline' = 'online',
  ): Promise<{ vote: AssemblyVote; stats: VoteStatsPayload }> {
    const question = await this.questionsRepository.findOne({ where: { id: dto.questionId } });
    if (!question) throw new NotFoundException(`Pregunta #${dto.questionId} no encontrada`);
    if (question.status !== 'active') throw new ConflictException('La pregunta no está activa');

    const existing = await this.votesRepository.findOne({
      where: { questionId: dto.questionId, residentId },
    });
    if (existing) throw new ConflictException('Ya emitiste tu voto para esta pregunta');

    const token = await this.getOrCreateToken(dto.assemblyId, residentId);

    const vote = this.votesRepository.create({
      questionId: dto.questionId,
      assemblyId: dto.assemblyId,
      residentId,
      vote: dto.vote,
      verificationToken: token.token,
      votedAt: dto.votedAt ? new Date(dto.votedAt) : new Date(),
      syncedAt: new Date(),
      source,
      isValid: true,
      rejectedReason: null,
    });

    await this.votesRepository.save(vote);
    const stats = await this.computeStats(dto.questionId, dto.assemblyId);
    return { vote, stats };
  }

  async syncVotes(
    assemblyId: string,
    votes: SubmitVoteDto[],
    residentId: string,
  ): Promise<VoteSyncResult[]> {
    const questions = await this.questionsRepository.find({ where: { assemblyId } });
    const questionMap = new Map(questions.map((q) => [q.id, q]));
    const token = await this.getOrCreateToken(assemblyId, residentId);

    const results: VoteSyncResult[] = [];

    for (const dto of votes) {
      const question = questionMap.get(dto.questionId);
      if (!question) {
        results.push({ questionId: dto.questionId, accepted: false, reason: 'question_not_found' });
        continue;
      }

      const existing = await this.votesRepository.findOne({
        where: { questionId: dto.questionId, residentId },
      });

      if (existing) {
        results.push({ questionId: dto.questionId, accepted: false, reason: 'already_voted_online' });
        continue;
      }

      const votedAt = dto.votedAt ? new Date(dto.votedAt) : new Date();
      let isValid = true;
      let rejectedReason: string | null = null;

      if (question.closedAt && votedAt >= question.closedAt) {
        isValid = false;
        rejectedReason = 'voted_after_question_closed';
      }

      const vote = this.votesRepository.create({
        questionId: dto.questionId,
        assemblyId,
        residentId,
        vote: dto.vote,
        verificationToken: token.token,
        votedAt,
        syncedAt: new Date(),
        source: 'offline',
        isValid,
        rejectedReason,
      });

      await this.votesRepository.save(vote);
      results.push({ questionId: dto.questionId, accepted: true, reason: rejectedReason ?? undefined });
    }

    return results;
  }

  async getOrCreateToken(assemblyId: string, residentId: string): Promise<AssemblyResidentToken> {
    const existing = await this.tokensRepository.findOne({
      where: { assemblyId, residentId },
    });
    if (existing) return existing;

    const token = await this.generateUniqueToken();
    const record = this.tokensRepository.create({ assemblyId, residentId, token });
    return this.tokensRepository.save(record);
  }

  async getPublicStats(publicId: string): Promise<PublicStatsPayload> {
    const assembly = await this.assembliesRepository.findOne({ where: { publicId } });
    if (!assembly) throw new NotFoundException('Asamblea no encontrada');

    const questions = await this.questionsRepository.find({
      where: { assemblyId: assembly.id },
      order: { order: 'ASC' },
    });

    const totalResidents = await this.residentsRepository.count({ where: { isActive: true } });

    const questionsWithStats = await Promise.all(
      questions.map(async (q) => {
        const stats = await this.computeStatsRaw(q.id, totalResidents);
        return {
          id: q.id,
          assemblyId: q.assemblyId,
          text: q.text,
          order: q.order,
          status: q.status,
          activatedAt: q.activatedAt?.toISOString() ?? null,
          closedAt: q.closedAt?.toISOString() ?? null,
          stats,
        };
      }),
    );

    return {
      assemblyId: assembly.publicId,
      title: assembly.title,
      description: assembly.description,
      status: assembly.status,
      scheduledDate: assembly.scheduledDate,
      questions: questionsWithStats,
    };
  }

  async verifyToken(
    publicId: string,
    token: string,
  ): Promise<{ questionText: string; vote: string }[]> {
    const assembly = await this.assembliesRepository.findOne({ where: { publicId } });
    if (!assembly) throw new NotFoundException('Asamblea no encontrada');

    const normalizedToken = token.replace(/-/g, '').toUpperCase();
    const votes = await this.votesRepository.find({
      where: { assemblyId: assembly.id, verificationToken: normalizedToken },
    });

    if (votes.length === 0) {
      throw new NotFoundException('Token no encontrado');
    }

    const questionIds = votes.map((v) => v.questionId);
    const questions = await this.questionsRepository.find({ where: { id: In(questionIds) } });
    const questionMap = new Map(questions.map((q) => [q.id, q]));

    return votes.map((v) => ({
      questionText: questionMap.get(v.questionId)?.text ?? 'Pregunta eliminada',
      vote: v.vote,
      isValid: v.isValid,
      rejectedReason: v.rejectedReason,
    }));
  }

  async getVotesForAssembly(assemblyId: string) {
    return this.votesRepository.find({
      where: { assemblyId },
      order: { createdAt: 'ASC' },
    });
  }

  async computeStats(questionId: string, assemblyId: string): Promise<VoteStatsPayload> {
    const totalResidents = await this.residentsRepository.count({ where: { isActive: true } });
    const stats = await this.computeStatsRaw(questionId, totalResidents);
    return { assemblyId, questionId, ...stats };
  }

  private async computeStatsRaw(questionId: string, totalResidents: number): Promise<QuestionStats> {
    const votes = await this.votesRepository.find({ where: { questionId, isValid: true } });
    const yesCount = votes.filter((v) => v.vote === 'yes').length;
    const noCount = votes.filter((v) => v.vote === 'no').length;
    const blankCount = votes.filter((v) => v.vote === 'blank').length;
    const totalVoted = votes.length;
    const totalPending = Math.max(0, totalResidents - totalVoted);
    return { totalVoted, totalPending, yesCount, noCount, blankCount };
  }

  private async generateUniqueToken(attempts = 0): Promise<string> {
    if (attempts > 5) throw new Error('No se pudo generar un token único');
    const token = crypto.randomBytes(6).toString('base64url').toUpperCase().slice(0, 9);
    const existing = await this.tokensRepository.findOne({ where: { token } });
    if (existing) return this.generateUniqueToken(attempts + 1);
    return token;
  }

  private async buildPayload(assemblyId: string): Promise<AssemblyPayload> {
    const assembly = await this.assembliesRepository.findOne({ where: { id: assemblyId } });
    if (!assembly) throw new NotFoundException(`Asamblea #${assemblyId} no encontrada`);

    const questions = await this.questionsRepository.find({
      where: { assemblyId },
      order: { order: 'ASC' },
    });

    const totalResidents = await this.residentsRepository.count({ where: { isActive: true } });

    const questionPayloads: QuestionPayload[] = await Promise.all(
      questions.map(async (q): Promise<QuestionPayload> => {
        const stats = await this.computeStatsRaw(q.id, totalResidents);
        return {
          id: q.id,
          assemblyId: q.assemblyId,
          text: q.text,
          order: q.order,
          status: q.status,
          activatedAt: q.activatedAt?.toISOString() ?? null,
          closedAt: q.closedAt?.toISOString() ?? null,
          stats,
        };
      }),
    );

    return {
      id: assembly.id,
      publicId: assembly.publicId,
      title: assembly.title,
      description: assembly.description,
      scheduledDate: assembly.scheduledDate,
      status: assembly.status,
      startedAt: assembly.startedAt?.toISOString() ?? null,
      finishedAt: assembly.finishedAt?.toISOString() ?? null,
      createdByEmployeeId: assembly.createdByEmployeeId,
      questions: questionPayloads,
      createdAt: assembly.createdAt.toISOString(),
    };
  }
}
