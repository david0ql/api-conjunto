import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, MoreThanOrEqual, Repository } from 'typeorm';
import { Apartment } from '../apartments/entities/apartment.entity';
import type { JwtPayload } from '../common/interfaces/jwt-payload.interface';
import { Employee } from '../employees/entities/employee.entity';
import { ResidentApartment } from '../resident-apartments/entities/resident-apartment.entity';
import { Resident } from '../residents/entities/resident.entity';
import type {
  CallApartmentSummary,
  CallSessionPayload,
  IceServerConfig,
} from './calls.types';
import { CallSession } from './entities/call-session.entity';

@Injectable()
export class CallsService {
  constructor(
    @InjectRepository(CallSession)
    private readonly callSessionsRepository: Repository<CallSession>,
    @InjectRepository(Apartment)
    private readonly apartmentsRepository: Repository<Apartment>,
    @InjectRepository(Employee)
    private readonly employeesRepository: Repository<Employee>,
    @InjectRepository(Resident)
    private readonly residentsRepository: Repository<Resident>,
    @InjectRepository(ResidentApartment)
    private readonly residentApartmentsRepository: Repository<ResidentApartment>,
    private readonly configService: ConfigService,
  ) {}

  async createCall(input: { apartmentId: string; initiatedByEmployeeId: string }) {
    const apartment = await this.apartmentsRepository.findOne({
      where: { id: input.apartmentId },
      relations: ['towerData'],
    });
    if (!apartment) {
      throw new NotFoundException(`Apartment #${input.apartmentId} not found`);
    }

    const employee = await this.employeesRepository.findOne({
      where: { id: input.initiatedByEmployeeId },
    });
    if (!employee) {
      throw new NotFoundException(`Employee #${input.initiatedByEmployeeId} not found`);
    }

    const targetResidentIds = await this.getTargetResidentIdsForApartment(apartment.id);
    if (targetResidentIds.length === 0) {
      throw new ConflictException('Este apartamento no tiene residentes activos para recibir la llamada');
    }

    const call = this.callSessionsRepository.create({
      apartmentId: apartment.id,
      initiatedByEmployeeId: employee.id,
      status: 'ringing',
      targetResidentIds,
      rejectedResidentIds: [],
    });
    const saved = await this.callSessionsRepository.save(call);
    return this.getPayload(saved.id);
  }

  async acceptCall(callId: string, residentId: string) {
    const call = await this.callSessionsRepository.findOne({ where: { id: callId } });
    if (!call) {
      throw new NotFoundException(`Call #${callId} not found`);
    }
    if (!call.targetResidentIds.includes(residentId)) {
      throw new ForbiddenException('Esta llamada no pertenece al residente autenticado');
    }
    if (call.acceptedByResidentId && call.acceptedByResidentId !== residentId) {
      throw new ConflictException('La llamada ya fue atendida por otro residente');
    }
    if (call.status !== 'ringing' && call.acceptedByResidentId !== residentId) {
      throw new ConflictException('La llamada ya no esta disponible');
    }

    call.acceptedByResidentId = residentId;
    call.acceptedAt = call.acceptedAt ?? new Date();
    call.status = 'active';
    await this.callSessionsRepository.save(call);

    return this.getPayload(call.id);
  }

  async rejectCall(callId: string, residentId: string) {
    const call = await this.callSessionsRepository.findOne({ where: { id: callId } });
    if (!call) {
      throw new NotFoundException(`Call #${callId} not found`);
    }
    if (!call.targetResidentIds.includes(residentId)) {
      throw new ForbiddenException('Esta llamada no pertenece al residente autenticado');
    }
    if (call.status !== 'ringing') {
      return { terminal: true, call: await this.getPayload(call.id) };
    }

    const rejectedResidentIds = new Set(call.rejectedResidentIds ?? []);
    rejectedResidentIds.add(residentId);
    call.rejectedResidentIds = Array.from(rejectedResidentIds);

    const terminal = call.rejectedResidentIds.length >= call.targetResidentIds.length;
    if (terminal) {
      call.status = 'rejected';
      call.endedReason = 'rejected';
      call.endedAt = new Date();
    }

    await this.callSessionsRepository.save(call);
    return { terminal, call: await this.getPayload(call.id) };
  }

  async timeoutCall(callId: string) {
    const call = await this.callSessionsRepository.findOne({ where: { id: callId } });
    if (!call || call.status !== 'ringing') {
      return null;
    }

    call.status = 'missed';
    call.endedAt = new Date();
    call.endedReason = 'timeout';
    await this.callSessionsRepository.save(call);

    return this.getPayload(call.id);
  }

  async endCall(
    callId: string,
    actor: { id: string; type: JwtPayload['type'] },
    reason?: string,
  ) {
    const call = await this.callSessionsRepository.findOne({ where: { id: callId } });
    if (!call) {
      throw new NotFoundException(`Call #${callId} not found`);
    }
    const isInitiator = actor.type === 'employee' && call.initiatedByEmployeeId === actor.id;
    const isAcceptedResident =
      actor.type === 'resident' && call.acceptedByResidentId === actor.id;
    if (!isInitiator && !isAcceptedResident) {
      throw new ForbiddenException('El usuario autenticado no puede finalizar esta llamada');
    }
    if (call.status === 'ended' || call.status === 'missed' || call.status === 'rejected') {
      return this.getPayload(call.id);
    }

    call.status = 'ended';
    call.endedAt = new Date();
    call.endedByUserId = actor.id;
    call.endedByUserType = actor.type;
    call.endedReason =
      reason ?? (call.acceptedByResidentId ? 'completed' : actor.type === 'employee' ? 'cancelled' : 'rejected');

    await this.callSessionsRepository.save(call);
    return this.getPayload(call.id);
  }

  async getPayload(callId: string): Promise<CallSessionPayload> {
    const call = await this.callSessionsRepository.findOne({
      where: { id: callId },
      relations: [
        'apartment',
        'apartment.towerData',
        'initiatedByEmployee',
        'acceptedByResident',
      ],
    });
    if (!call) {
      throw new NotFoundException(`Call #${callId} not found`);
    }

    return {
      id: call.id,
      status: call.status,
      apartmentId: call.apartmentId,
      apartment: this.toApartmentSummary(call.apartment),
      initiatedByEmployeeId: call.initiatedByEmployeeId,
      initiatedByEmployee: call.initiatedByEmployee
        ? {
            id: call.initiatedByEmployee.id,
            name: call.initiatedByEmployee.name,
            lastName: call.initiatedByEmployee.lastName,
          }
        : null,
      acceptedByResidentId: call.acceptedByResidentId,
      acceptedByResident: call.acceptedByResident
        ? {
            id: call.acceptedByResident.id,
            name: call.acceptedByResident.name,
            lastName: call.acceptedByResident.lastName,
          }
        : null,
      targetResidentIds: call.targetResidentIds ?? [],
      rejectedResidentIds: call.rejectedResidentIds ?? [],
      endedByUserId: call.endedByUserId,
      endedByUserType: call.endedByUserType,
      endedReason: call.endedReason,
      createdAt: call.createdAt.toISOString(),
      acceptedAt: call.acceptedAt?.toISOString() ?? null,
      endedAt: call.endedAt?.toISOString() ?? null,
    };
  }

  async getApartmentIdsForResident(residentId: string) {
    const resident = await this.residentsRepository.findOne({
      where: { id: residentId },
      select: { apartmentId: true, id: true },
    });

    const linkedApartments = await this.residentApartmentsRepository.find({
      where: [
        { residentId, endDate: IsNull() },
        { residentId, endDate: MoreThanOrEqual(new Date().toISOString().slice(0, 10)) },
      ],
      select: { apartmentId: true, residentId: true, id: true },
    });

    return Array.from(
      new Set(
        [resident?.apartmentId, ...linkedApartments.map((item) => item.apartmentId)].filter(Boolean),
      ),
    ) as string[];
  }

  async ensureCanSignal(callId: string, actor: JwtPayload) {
    const call = await this.callSessionsRepository.findOne({ where: { id: callId } });
    if (!call) {
      throw new NotFoundException(`Call #${callId} not found`);
    }

    const isInitiator = actor.type === 'employee' && call.initiatedByEmployeeId === actor.sub;
    const isAcceptedResident =
      actor.type === 'resident' && call.acceptedByResidentId === actor.sub;
    if (!isInitiator && !isAcceptedResident) {
      throw new ForbiddenException('El usuario autenticado no participa en esta llamada');
    }

    return call;
  }

  getIceServers(): IceServerConfig[] {
    const rawIceServers = this.configService.get<string>('WEBRTC_ICE_SERVERS');
    if (rawIceServers) {
      try {
        const parsed = JSON.parse(rawIceServers) as IceServerConfig[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      } catch {}
    }

    const fallback: IceServerConfig[] = [
      {
        urls: [
          'stun:stun.l.google.com:19302',
          'stun:stun1.l.google.com:19302',
        ],
      },
    ];

    const turnUrls = this.configService.get<string>('WEBRTC_TURN_URLS');
    const turnUsername = this.configService.get<string>('WEBRTC_TURN_USERNAME');
    const turnCredential = this.configService.get<string>('WEBRTC_TURN_CREDENTIAL');
    if (turnUrls && turnUsername && turnCredential) {
      fallback.push({
        urls: turnUrls.split(',').map((item) => item.trim()).filter(Boolean),
        username: turnUsername,
        credential: turnCredential,
      });
    }

    return fallback;
  }

  private async getTargetResidentIdsForApartment(apartmentId: string) {
    const directResidents = await this.residentsRepository.find({
      where: { apartmentId, isActive: true },
      select: { id: true },
    });

    const linkedResidentRelations = await this.residentApartmentsRepository.find({
      where: [
        { apartmentId, endDate: IsNull() },
        { apartmentId, endDate: MoreThanOrEqual(new Date().toISOString().slice(0, 10)) },
      ],
      select: { residentId: true },
    });

    const residentIds = Array.from(
      new Set([
        ...directResidents.map((resident) => resident.id),
        ...linkedResidentRelations.map((relation) => relation.residentId),
      ]),
    );
    if (residentIds.length === 0) {
      return [];
    }

    const activeResidents = await this.residentsRepository.find({
      where: { id: In(residentIds), isActive: true },
      select: { id: true },
    });
    return activeResidents.map((resident) => resident.id);
  }

  private toApartmentSummary(apartment?: Apartment | null): CallApartmentSummary | null {
    if (!apartment) return null;

    return {
      id: apartment.id,
      number: apartment.number,
      floor: apartment.floor ?? null,
      tower: apartment.towerData
        ? {
            id: apartment.towerData.id,
            code: apartment.towerData.code,
            name: apartment.towerData.name,
          }
        : null,
    };
  }
}
