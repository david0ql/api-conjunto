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
  CallPorterAvailabilityPayload,
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
    await this.assertEmployeeAvailable(
      employee.id,
      'Este empleado ya tiene una llamada en curso y no puede iniciar otra todavía',
    );

    const targetResidentIds = await this.getTargetResidentIdsForApartment(apartment.id);
    if (targetResidentIds.length === 0) {
      throw new ConflictException('Este apartamento no tiene residentes activos para recibir la llamada');
    }

    const call = this.callSessionsRepository.create({
      direction: 'outbound',
      apartmentId: apartment.id,
      initiatedByEmployeeId: employee.id,
      status: 'ringing',
      targetResidentIds,
      targetEmployeeIds: [],
      rejectedResidentIds: [],
      rejectedEmployeeIds: [],
    });
    const saved = await this.callSessionsRepository.save(call);
    return this.getPayload(saved.id);
  }

  async getPorters(): Promise<CallPorterAvailabilityPayload[]> {
    const [porters, openCalls] = await Promise.all([
      this.employeesRepository
        .createQueryBuilder('employee')
        .innerJoinAndSelect('employee.role', 'role')
        .where('employee.isActive = :isActive', { isActive: true })
        .andWhere('role.code = :roleCode', { roleCode: 'porter' })
        .orderBy('employee.username', 'ASC')
        .getMany(),
      this.callSessionsRepository.find({
        where: { status: In(['ringing', 'active']) },
        relations: [
          'apartment',
          'apartment.towerData',
          'initiatedByEmployee',
          'initiatedByResident',
          'acceptedByResident',
          'acceptedByEmployee',
        ],
        order: { createdAt: 'DESC' },
      }),
    ]);

    const porterById = new Map(porters.map((porter) => [porter.id, porter]));
    const openCallByPorterId = new Map<string, CallPorterAvailabilityPayload['currentCall']>();

    openCalls.forEach((call) => {
      this.getEmployeeParticipantIds(call).forEach((employeeId) => {
        if (!porterById.has(employeeId) || openCallByPorterId.has(employeeId)) {
          return;
        }
        openCallByPorterId.set(
          employeeId,
          this.toPorterCurrentCall(call, employeeId, porterById),
        );
      });
    });

    return porters.map((porter) => {
      const currentCall = openCallByPorterId.get(porter.id) ?? null;
      return {
        id: porter.id,
        username: porter.username,
        name: porter.name,
        lastName: porter.lastName,
        available: !currentCall,
        status: currentCall ? 'busy' : 'available',
        currentCall,
      };
    });
  }

  async getCallHistory(): Promise<CallSessionPayload[]> {
    const calls = await this.callSessionsRepository.find({
      relations: [
        'apartment',
        'apartment.towerData',
        'initiatedByEmployee',
        'initiatedByResident',
        'acceptedByResident',
        'acceptedByEmployee',
      ],
      order: { createdAt: 'DESC' },
    });

    return calls.map((call) => this.toCallPayload(call));
  }

  async createPorterCall(residentId: string, targetEmployeeId: string) {
    const resident = await this.residentsRepository.findOne({
      where: { id: residentId, isActive: true },
    });
    if (!resident) {
      throw new NotFoundException(`Resident #${residentId} not found`);
    }

    const porter = await this.employeesRepository
      .createQueryBuilder('employee')
      .innerJoinAndSelect('employee.role', 'role')
      .where('employee.id = :employeeId', { employeeId: targetEmployeeId })
      .andWhere('employee.isActive = :isActive', { isActive: true })
      .andWhere('role.code = :roleCode', { roleCode: 'porter' })
      .getOne();
    if (!porter) {
      throw new NotFoundException('El portero seleccionado no existe o no está activo');
    }
    await this.assertEmployeeAvailable(
      porter.id,
      'El portero seleccionado ya está atendiendo otra llamada',
    );

    const apartmentIds = await this.getApartmentIdsForResident(residentId);

    const call = this.callSessionsRepository.create({
      direction: 'inbound',
      apartmentId: apartmentIds[0] ?? null,
      initiatedByResidentId: residentId,
      status: 'ringing',
      targetResidentIds: [],
      targetEmployeeIds: [porter.id],
      rejectedResidentIds: [],
      rejectedEmployeeIds: [],
    });
    const saved = await this.callSessionsRepository.save(call);
    return this.getPayload(saved.id);
  }

  async createInternalPorterCall(input: { initiatedByEmployeeId: string; targetEmployeeId: string }) {
    if (input.initiatedByEmployeeId === input.targetEmployeeId) {
      throw new ConflictException('No puedes llamarte a ti mismo');
    }

    const initiator = await this.getActivePorterById(input.initiatedByEmployeeId);
    if (!initiator) {
      throw new NotFoundException('El portero que inicia la llamada no existe o no está activo');
    }

    const target = await this.getActivePorterById(input.targetEmployeeId);
    if (!target) {
      throw new NotFoundException('El portero seleccionado no existe o no está activo');
    }

    await this.assertEmployeeAvailable(
      initiator.id,
      'Ya tienes una llamada en curso y no puedes iniciar otra todavía',
    );
    await this.assertEmployeeAvailable(
      target.id,
      'El portero seleccionado ya está atendiendo otra llamada',
    );

    const call = this.callSessionsRepository.create({
      direction: 'internal',
      apartmentId: null,
      initiatedByEmployeeId: initiator.id,
      status: 'ringing',
      targetResidentIds: [],
      targetEmployeeIds: [target.id],
      rejectedResidentIds: [],
      rejectedEmployeeIds: [],
    });
    const saved = await this.callSessionsRepository.save(call);
    return this.getPayload(saved.id);
  }

  async acceptCall(callId: string, actor: { id: string; type: JwtPayload['type'] }) {
    const call = await this.callSessionsRepository.findOne({ where: { id: callId } });
    if (!call) {
      throw new NotFoundException(`Call #${callId} not found`);
    }

    if (call.direction === 'outbound') {
      // Resident accepts employee-initiated call
      if (actor.type !== 'resident') {
        throw new ForbiddenException('Solo residentes pueden contestar esta llamada');
      }
      const residentId = actor.id;
      if (!(call.targetResidentIds ?? []).includes(residentId)) {
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
    } else {
      // Employee accepts resident-initiated or internal porter call
      if (actor.type !== 'employee') {
        throw new ForbiddenException('Solo empleados pueden contestar esta llamada');
      }
      const employeeId = actor.id;
      if (!(call.targetEmployeeIds ?? []).includes(employeeId)) {
        throw new ForbiddenException('Esta llamada no pertenece al empleado autenticado');
      }
      await this.assertEmployeeAvailable(
        employeeId,
        'El empleado ya está atendiendo otra llamada',
        call.id,
      );
      if (call.acceptedByEmployeeId && call.acceptedByEmployeeId !== employeeId) {
        throw new ConflictException('La llamada ya fue atendida por otro portero');
      }
      if (call.status !== 'ringing' && call.acceptedByEmployeeId !== employeeId) {
        throw new ConflictException('La llamada ya no esta disponible');
      }
      call.acceptedByEmployeeId = employeeId;
      call.acceptedAt = call.acceptedAt ?? new Date();
      call.status = 'active';
    }

    await this.callSessionsRepository.save(call);
    return this.getPayload(call.id);
  }

  async rejectCall(callId: string, actor: { id: string; type: JwtPayload['type'] }) {
    const call = await this.callSessionsRepository.findOne({ where: { id: callId } });
    if (!call) {
      throw new NotFoundException(`Call #${callId} not found`);
    }

    if (call.direction === 'outbound') {
      if (actor.type !== 'resident') {
        throw new ForbiddenException('Solo residentes pueden rechazar esta llamada');
      }
      if (!(call.targetResidentIds ?? []).includes(actor.id)) {
        throw new ForbiddenException('Esta llamada no pertenece al residente autenticado');
      }
      if (call.status !== 'ringing') {
        return { terminal: true, call: await this.getPayload(call.id) };
      }

      const rejected = new Set(call.rejectedResidentIds ?? []);
      rejected.add(actor.id);
      call.rejectedResidentIds = Array.from(rejected);

      const terminal = call.rejectedResidentIds.length >= (call.targetResidentIds ?? []).length;
      if (terminal) {
        call.status = 'rejected';
        call.endedReason = 'rejected';
        call.endedAt = new Date();
      }
    } else {
      if (actor.type !== 'employee') {
        throw new ForbiddenException('Solo empleados pueden rechazar esta llamada');
      }
      if (!(call.targetEmployeeIds ?? []).includes(actor.id)) {
        throw new ForbiddenException('Esta llamada no pertenece al empleado autenticado');
      }
      if (call.status !== 'ringing') {
        return { terminal: true, call: await this.getPayload(call.id) };
      }

      const rejected = new Set(call.rejectedEmployeeIds ?? []);
      rejected.add(actor.id);
      call.rejectedEmployeeIds = Array.from(rejected);

      const terminal = call.rejectedEmployeeIds.length >= (call.targetEmployeeIds ?? []).length;
      if (terminal) {
        call.status = 'rejected';
        call.endedReason = 'rejected';
        call.endedAt = new Date();
      }
    }

    await this.callSessionsRepository.save(call);
    return { terminal: call.status === 'rejected', call: await this.getPayload(call.id) };
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

    const isOutboundInitiator = call.direction === 'outbound' && actor.type === 'employee' && call.initiatedByEmployeeId === actor.id;
    const isInboundInitiator = call.direction === 'inbound' && actor.type === 'resident' && call.initiatedByResidentId === actor.id;
    const isInternalInitiator = call.direction === 'internal' && actor.type === 'employee' && call.initiatedByEmployeeId === actor.id;
    const isOutboundAcceptor = call.direction === 'outbound' && actor.type === 'resident' && call.acceptedByResidentId === actor.id;
    const isInboundAcceptor = call.direction === 'inbound' && actor.type === 'employee' && call.acceptedByEmployeeId === actor.id;
    const isInternalAcceptor = call.direction === 'internal' && actor.type === 'employee' && call.acceptedByEmployeeId === actor.id;

    if (
      !isOutboundInitiator &&
      !isInboundInitiator &&
      !isInternalInitiator &&
      !isOutboundAcceptor &&
      !isInboundAcceptor &&
      !isInternalAcceptor
    ) {
      throw new ForbiddenException('El usuario autenticado no puede finalizar esta llamada');
    }
    if (call.status === 'ended' || call.status === 'missed' || call.status === 'rejected') {
      return this.getPayload(call.id);
    }

    call.status = 'ended';
    call.endedAt = new Date();
    call.endedByUserId = actor.id;
    call.endedByUserType = actor.type;
    const hasAcceptedParticipant =
      (call.direction === 'outbound' && Boolean(call.acceptedByResidentId)) ||
      ((call.direction === 'inbound' || call.direction === 'internal') &&
        Boolean(call.acceptedByEmployeeId));

    call.endedReason = reason ?? (
      hasAcceptedParticipant
        ? 'completed'
        : actor.type === 'employee' || isInboundInitiator
          ? 'cancelled'
          : 'rejected'
    );

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
        'initiatedByResident',
        'acceptedByResident',
        'acceptedByEmployee',
      ],
    });
    if (!call) {
      throw new NotFoundException(`Call #${callId} not found`);
    }

    return this.toCallPayload(call);
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

    const isOutboundInitiator = call.direction === 'outbound' && actor.type === 'employee' && call.initiatedByEmployeeId === actor.sub;
    const isInboundInitiator = call.direction === 'inbound' && actor.type === 'resident' && call.initiatedByResidentId === actor.sub;
    const isInternalInitiator = call.direction === 'internal' && actor.type === 'employee' && call.initiatedByEmployeeId === actor.sub;
    const isOutboundAcceptor = call.direction === 'outbound' && actor.type === 'resident' && call.acceptedByResidentId === actor.sub;
    const isInboundAcceptor = call.direction === 'inbound' && actor.type === 'employee' && call.acceptedByEmployeeId === actor.sub;
    const isInternalAcceptor = call.direction === 'internal' && actor.type === 'employee' && call.acceptedByEmployeeId === actor.sub;

    if (
      !isOutboundInitiator &&
      !isInboundInitiator &&
      !isInternalInitiator &&
      !isOutboundAcceptor &&
      !isInboundAcceptor &&
      !isInternalAcceptor
    ) {
      throw new ForbiddenException('El usuario autenticado no participa en esta llamada');
    }

    if (call.status !== 'active') {
      return null;
    }

    return call;
  }

  getSignalTarget(call: CallSession, actor: JwtPayload): { sub: string; type: JwtPayload['type'] } | null {
    if (call.direction === 'outbound') {
      if (actor.type === 'employee') {
        return call.acceptedByResidentId ? { sub: call.acceptedByResidentId, type: 'resident' } : null;
      }
      return call.initiatedByEmployeeId ? { sub: call.initiatedByEmployeeId, type: 'employee' } : null;
    }

    if (call.direction === 'inbound') {
      if (actor.type === 'resident') {
        return call.acceptedByEmployeeId ? { sub: call.acceptedByEmployeeId, type: 'employee' } : null;
      }
      return call.initiatedByResidentId ? { sub: call.initiatedByResidentId, type: 'resident' } : null;
    }

    if (actor.sub === call.initiatedByEmployeeId) {
      return call.acceptedByEmployeeId ? { sub: call.acceptedByEmployeeId, type: 'employee' } : null;
    }

    return call.initiatedByEmployeeId ? { sub: call.initiatedByEmployeeId, type: 'employee' } : null;
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

  private async getActivePorterById(employeeId: string) {
    return this.employeesRepository
      .createQueryBuilder('employee')
      .innerJoinAndSelect('employee.role', 'role')
      .where('employee.id = :employeeId', { employeeId })
      .andWhere('employee.isActive = :isActive', { isActive: true })
      .andWhere('role.code = :roleCode', { roleCode: 'porter' })
      .getOne();
  }

  private getEmployeeParticipantIds(call: CallSession) {
    return Array.from(
      new Set(
        [
          call.initiatedByEmployeeId,
          call.acceptedByEmployeeId,
          ...(call.targetEmployeeIds ?? []),
        ].filter(Boolean),
      ),
    ) as string[];
  }

  private toPorterCurrentCall(
    call: CallSession,
    porterId: string,
    porterById: Map<string, Employee>,
  ): CallPorterAvailabilityPayload['currentCall'] {
    const apartment = call.apartment ? this.toApartmentSummary(call.apartment) : null;

    if (call.direction === 'internal') {
      const counterpartId =
        porterId === call.initiatedByEmployeeId
          ? call.acceptedByEmployeeId ?? (call.targetEmployeeIds ?? []).find((id) => id !== porterId) ?? null
          : call.initiatedByEmployeeId;
      const counterpart =
        (counterpartId && porterById.get(counterpartId)) ??
        (counterpartId === call.initiatedByEmployee?.id ? call.initiatedByEmployee : null) ??
        (counterpartId === call.acceptedByEmployee?.id ? call.acceptedByEmployee : null);

      return {
        callId: call.id,
        direction: call.direction,
        status: call.status as 'ringing' | 'active',
        withType: 'employee',
        withLabel: counterpart
          ? `${counterpart.name} ${counterpart.lastName}`
          : 'Otro portero',
        apartment: null,
      };
    }

    if (call.direction === 'inbound') {
      const residentName = call.initiatedByResident
        ? `${call.initiatedByResident.name} ${call.initiatedByResident.lastName}`
        : 'Residente';

      return {
        callId: call.id,
        direction: call.direction,
        status: call.status as 'ringing' | 'active',
        withType: 'resident',
        withLabel: residentName,
        apartment,
      };
    }

    if (call.acceptedByResident) {
      return {
        callId: call.id,
        direction: call.direction,
        status: call.status as 'ringing' | 'active',
        withType: 'resident',
        withLabel: `${call.acceptedByResident.name} ${call.acceptedByResident.lastName}`,
        apartment,
      };
    }

    return {
      callId: call.id,
      direction: call.direction,
      status: call.status as 'ringing' | 'active',
      withType: apartment ? 'apartment' : 'resident',
      withLabel: apartment
        ? `${apartment.tower?.name ?? 'Torre'} · Apt. ${apartment.number}`
        : 'Apartamento asignado',
      apartment,
    };
  }

  private toCallPayload(call: CallSession): CallSessionPayload {
    return {
      id: call.id,
      status: call.status,
      direction: call.direction,
      apartmentId: call.apartmentId,
      apartment: call.apartment ? this.toApartmentSummary(call.apartment) : null,
      initiatedByEmployeeId: call.initiatedByEmployeeId,
      initiatedByEmployee: call.initiatedByEmployee
        ? {
            id: call.initiatedByEmployee.id,
            name: call.initiatedByEmployee.name,
            lastName: call.initiatedByEmployee.lastName,
          }
        : null,
      initiatedByResidentId: call.initiatedByResidentId,
      initiatedByResident: call.initiatedByResident
        ? {
            id: call.initiatedByResident.id,
            name: call.initiatedByResident.name,
            lastName: call.initiatedByResident.lastName,
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
      acceptedByEmployeeId: call.acceptedByEmployeeId,
      acceptedByEmployee: call.acceptedByEmployee
        ? {
            id: call.acceptedByEmployee.id,
            name: call.acceptedByEmployee.name,
            lastName: call.acceptedByEmployee.lastName,
          }
        : null,
      targetResidentIds: call.targetResidentIds ?? [],
      targetEmployeeIds: call.targetEmployeeIds ?? [],
      rejectedResidentIds: call.rejectedResidentIds ?? [],
      rejectedEmployeeIds: call.rejectedEmployeeIds ?? [],
      endedByUserId: call.endedByUserId,
      endedByUserType: call.endedByUserType,
      endedReason: call.endedReason,
      createdAt: call.createdAt.toISOString(),
      acceptedAt: call.acceptedAt?.toISOString() ?? null,
      endedAt: call.endedAt?.toISOString() ?? null,
    };
  }

  private async assertEmployeeAvailable(
    employeeId: string,
    message: string,
    excludeCallId?: string,
  ) {
    const busyEmployeeIds = await this.getBusyEmployeeIds(excludeCallId);
    if (busyEmployeeIds.has(employeeId)) {
      throw new ConflictException(message);
    }
  }

  private async getBusyEmployeeIds(excludeCallId?: string) {
    const openCalls = await this.callSessionsRepository.find({
      where: [{ status: 'ringing' }, { status: 'active' }],
      select: {
        id: true,
        initiatedByEmployeeId: true,
        acceptedByEmployeeId: true,
        targetEmployeeIds: true,
      },
    });

    const busyEmployeeIds = new Set<string>();
    for (const call of openCalls) {
      if (excludeCallId && call.id === excludeCallId) {
        continue;
      }
      if (call.initiatedByEmployeeId) {
        busyEmployeeIds.add(call.initiatedByEmployeeId);
      }
      if (call.acceptedByEmployeeId) {
        busyEmployeeIds.add(call.acceptedByEmployeeId);
      }
      for (const employeeId of call.targetEmployeeIds ?? []) {
        busyEmployeeIds.add(employeeId);
      }
    }

    return busyEmployeeIds;
  }

  private toApartmentSummary(apartment: Apartment): CallApartmentSummary {
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
