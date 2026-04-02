import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CommunitySpace } from './entities/community-space.entity';
import { CreateCommunitySpaceDto } from './dto/create-community-space.dto';
import { UpdateCommunitySpaceDto } from './dto/update-community-space.dto';
import { CommunitySpaceSchedule } from './entities/community-space-schedule.entity';

@Injectable()
export class CommunitySpacesService {
  constructor(
    @InjectRepository(CommunitySpace)
    private repository: Repository<CommunitySpace>,
    @InjectRepository(CommunitySpaceSchedule)
    private readonly schedulesRepository: Repository<CommunitySpaceSchedule>,
  ) {}

  findAll(): Promise<CommunitySpace[]> {
    return this.repository.find({
      order: { phase: 'ASC', name: 'ASC', schedules: { dayOfWeek: 'ASC' } },
    });
  }

  async findOne(id: string): Promise<CommunitySpace> {
    const item = await this.repository.findOne({
      where: { id },
      order: { schedules: { dayOfWeek: 'ASC' } },
    });
    if (!item) throw new NotFoundException(`CommunitySpace #${id} not found`);
    return item;
  }

  async create(dto: CreateCommunitySpaceDto): Promise<CommunitySpace> {
    const { schedules, ...spaceData } = dto;
    const item = await this.repository.save(this.repository.create(spaceData));
    if (schedules) {
      await this.replaceSchedules(item.id, schedules);
    }
    return this.findOne(item.id);
  }

  async update(id: string, dto: UpdateCommunitySpaceDto): Promise<CommunitySpace> {
    const { schedules, ...spaceData } = dto;
    const item = await this.findOne(id);
    Object.assign(item, spaceData);
    await this.repository.save(item);
    if (schedules) {
      await this.replaceSchedules(id, schedules);
    }
    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    const item = await this.findOne(id);
    await this.repository.remove(item);
  }

  private async replaceSchedules(
    communitySpaceId: string,
    schedules: NonNullable<CreateCommunitySpaceDto['schedules']>,
  ): Promise<void> {
    const normalized = this.normalizeSchedules(schedules);
    await this.schedulesRepository.delete({ communitySpaceId });
    if (normalized.length === 0) {
      return;
    }
    const rows = normalized.map((schedule) =>
      this.schedulesRepository.create({
        communitySpaceId,
        dayOfWeek: schedule.dayOfWeek,
        isOpen: schedule.isOpen,
        startTime: schedule.startTime ?? null,
        endTime: schedule.endTime ?? null,
      }),
    );
    await this.schedulesRepository.save(rows);
  }

  private normalizeSchedules(
    schedules: NonNullable<CreateCommunitySpaceDto['schedules']>,
  ): NonNullable<CreateCommunitySpaceDto['schedules']> {
    const seenDays = new Set<number>();
    return schedules.map((schedule) => {
      if (seenDays.has(schedule.dayOfWeek)) {
        throw new BadRequestException(`Repeated dayOfWeek value: ${schedule.dayOfWeek}`);
      }
      seenDays.add(schedule.dayOfWeek);

      if (!schedule.isOpen) {
        return {
          dayOfWeek: schedule.dayOfWeek,
          isOpen: false,
          startTime: null,
          endTime: null,
        };
      }

      if (!schedule.startTime || !schedule.endTime) {
        throw new BadRequestException(`Day ${schedule.dayOfWeek} is open but start/end times are missing`);
      }

      if (schedule.startTime >= schedule.endTime) {
        throw new BadRequestException(`Day ${schedule.dayOfWeek} has invalid time range`);
      }

      return schedule;
    });
  }
}
