import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import { PasswordResetToken } from './entities/password-reset-token.entity';
import { Resident } from '../residents/entities/resident.entity';
import { MailService } from '../mail/mail.service';

const GENERIC_INVALID = 'El enlace no es válido o ha expirado. Solicita uno nuevo a la administración.';

@Injectable()
export class PasswordResetsService {
  private readonly logger = new Logger(PasswordResetsService.name);

  constructor(
    @InjectRepository(PasswordResetToken)
    private readonly tokensRepo: Repository<PasswordResetToken>,
    @InjectRepository(Resident)
    private readonly residentsRepo: Repository<Resident>,
    private readonly mailService: MailService,
    private readonly config: ConfigService,
  ) {}

  private hashToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  private get ttlMinutes(): number {
    const minutes = Number(this.config.get('PASSWORD_RESET_TTL_MINUTES'));
    return Number.isFinite(minutes) && minutes > 0 ? minutes : 60;
  }

  private buildResetUrl(rawToken: string): string {
    const base = (this.config.get<string>('FRONTEND_URL') || 'http://localhost:5173').replace(/\/+$/, '');
    return `${base}/reset-password/${rawToken}`;
  }

  /**
   * Admin-initiated. Issues a single-use token and emails the reset link.
   * Any previously outstanding token for the resident is invalidated so only
   * the most recent link works.
   */
  async requestForResident(
    residentId: string,
    employeeId: string,
    ip?: string,
  ): Promise<{ emailSent: boolean }> {
    const resident = await this.residentsRepo.findOne({ where: { id: residentId } });
    if (!resident) throw new NotFoundException('Residente no encontrado');
    if (!resident.isActive) throw new BadRequestException('El residente está inactivo');
    if (!resident.email?.trim()) {
      throw new BadRequestException('El residente no tiene un correo registrado');
    }

    // Single active token policy: burn any unused tokens for this resident.
    await this.tokensRepo.update(
      { residentId, usedAt: IsNull() },
      { usedAt: new Date() },
    );

    const rawToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + this.ttlMinutes * 60_000);

    await this.tokensRepo.save(
      this.tokensRepo.create({
        residentId,
        tokenHash: this.hashToken(rawToken),
        expiresAt,
        requestedByEmployeeId: employeeId ?? null,
        requestIp: ip ?? null,
      }),
    );

    const emailSent = await this.mailService.sendPasswordReset(resident.email.trim(), {
      name: `${resident.name} ${resident.lastName}`.trim(),
      resetUrl: this.buildResetUrl(rawToken),
      ttlMinutes: this.ttlMinutes,
    });

    this.logger.log(
      `Password reset requested for resident ${resident.id} by employee ${employeeId} (emailSent=${emailSent})`,
    );
    return { emailSent };
  }

  private async findUsableToken(rawToken: string): Promise<PasswordResetToken | null> {
    if (!rawToken || rawToken.length < 20) return null;
    const token = await this.tokensRepo.findOne({ where: { tokenHash: this.hashToken(rawToken) } });
    if (!token) return null;
    if (token.usedAt) return null;
    if (token.expiresAt.getTime() < Date.now()) return null;
    return token;
  }

  /** Public. Returns a generic shape (no enumeration) used to render the form. */
  async validate(rawToken: string): Promise<{ valid: boolean; name?: string }> {
    const token = await this.findUsableToken(rawToken);
    if (!token) return { valid: false };
    const resident = await this.residentsRepo.findOne({ where: { id: token.residentId } });
    if (!resident || !resident.isActive) return { valid: false };
    return { valid: true, name: resident.name };
  }

  /** Public. Sets the new password and atomically consumes the token. */
  async confirm(rawToken: string, newPassword: string, ip?: string): Promise<{ success: boolean }> {
    const token = await this.findUsableToken(rawToken);
    if (!token) throw new BadRequestException(GENERIC_INVALID);

    const resident = await this.residentsRepo.findOne({ where: { id: token.residentId } });
    if (!resident || !resident.isActive) throw new BadRequestException(GENERIC_INVALID);

    const passwordHash = await bcrypt.hash(newPassword, 10);

    // Consume the token FIRST, guarded on usedAt IS NULL. If a concurrent request
    // already consumed it, `affected` is 0 and we abort — prevents double use.
    const consumed = await this.tokensRepo.update(
      { id: token.id, usedAt: IsNull() },
      { usedAt: new Date(), consumedIp: ip ?? null },
    );
    if (!consumed.affected) throw new BadRequestException(GENERIC_INVALID);

    await this.residentsRepo.update(resident.id, { passwordHash });
    this.logger.log(`Password reset completed for resident ${resident.id}`);
    return { success: true };
  }
}
