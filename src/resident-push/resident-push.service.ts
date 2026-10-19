import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CallsPushService } from '../calls/calls-push.service';
import { CallDevice } from '../calls/entities/call-device.entity';
import { Apartment } from '../apartments/entities/apartment.entity';
import { ResidentApartment } from '../resident-apartments/entities/resident-apartment.entity';
import { Resident } from '../residents/entities/resident.entity';

interface ResidentPushInput {
  /** Id of the record that triggered the push (package, access, news...). */
  referenceId: string;
  title: string;
  body: string;
  notificationTypeCode: string;
}

/**
 * Plain pushes for residents: to everyone living in an apartment (packages,
 * visits) or to every resident with the app installed (news). Never throws:
 * a failed push must not break the porter's or admin's request.
 */
@Injectable()
export class ResidentPushService {
  private readonly logger = new Logger(ResidentPushService.name);

  constructor(
    @InjectRepository(CallDevice)
    private readonly devicesRepository: Repository<CallDevice>,
    @InjectRepository(Apartment)
    private readonly apartmentsRepository: Repository<Apartment>,
    @InjectRepository(ResidentApartment)
    private readonly residentApartmentsRepository: Repository<ResidentApartment>,
    @InjectRepository(Resident)
    private readonly residentsRepository: Repository<Resident>,
    private readonly callsPushService: CallsPushService,
  ) {}

  /** Fire-and-forget push to every resident of the apartment. */
  notifyApartment(
    apartmentId: string | null | undefined,
    input: ResidentPushInput,
  ) {
    if (!apartmentId) return;
    void this.run(input, async () => {
      const userIds = await this.getApartmentResidentIds(apartmentId);
      await this.callsPushService.sendUserNotification({
        userType: 'resident',
        userIds,
        ...this.toPayload(input),
      });
    });
  }

  /** Fire-and-forget push to every resident with an active device. */
  notifyAllResidents(input: ResidentPushInput) {
    void this.run(input, async () => {
      const rows = await this.devicesRepository
        .createQueryBuilder('d')
        .select('DISTINCT d.user_id', 'userId')
        .where("d.user_type = 'resident'")
        .andWhere("d.channel = 'fcm'")
        .andWhere('d.is_active = true')
        .getRawMany<{ userId: string }>();
      const userIds = rows.map((row) => row.userId);
      await this.callsPushService.sendUserNotification({
        userType: 'resident',
        userIds,
        ...this.toPayload(input),
      });
    });
  }

  /** "Torre 2 · Apto 301" (or just "Apto 301" when the tower is unknown). */
  async describeApartment(
    apartmentId: string | null | undefined,
  ): Promise<string | null> {
    if (!apartmentId) return null;
    const apartment = await this.apartmentsRepository.findOne({
      where: { id: apartmentId },
    });
    if (!apartment) return null;
    const tower = apartment.towerData?.name
      ? `${apartment.towerData.name} · `
      : '';
    return `${tower}Apto ${apartment.number}`;
  }

  async getApartmentResidentIds(apartmentId: string): Promise<string[]> {
    const [links, residents] = await Promise.all([
      this.residentApartmentsRepository.find({
        where: { apartmentId },
        select: ['residentId'],
      }),
      this.residentsRepository.find({
        where: { apartmentId, isActive: true },
        select: ['id'],
      }),
    ]);
    return Array.from(
      new Set([
        ...links.map((row) => row.residentId),
        ...residents.map((row) => row.id),
      ]),
    );
  }

  private toPayload(input: ResidentPushInput) {
    return {
      notificationId: input.referenceId,
      title: input.title,
      body: input.body,
      notificationTypeCode: input.notificationTypeCode,
    };
  }

  private async run(input: ResidentPushInput, send: () => Promise<void>) {
    try {
      await send();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(
        `No fue posible enviar push ${input.notificationTypeCode} ${input.referenceId}: ${message}`,
      );
    }
  }
}
