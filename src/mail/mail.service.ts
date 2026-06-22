import { Inject, Injectable, Logger } from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import {
  LOGO_CID,
  renderCredentialsEmail,
  renderRejectionEmail,
  type CredentialsEmailParams,
  type RejectionEmailParams,
} from './mail.templates';

export const MAILER_PROVIDER = 'CONJUNTO_MAILER';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(
    @Inject(MAILER_PROVIDER) private readonly mailer: MailerService,
    private readonly config: ConfigService,
  ) {}

  private get from(): string {
    return this.config.get<string>('MAIL_FROM') || this.config.get<string>('MAIL_USER') || '';
  }

  private get appName(): string {
    return this.config.get<string>('MAIL_APP_NAME') || 'Nordikhat';
  }

  /** When MAIL_TEST_REDIRECT is set, every recipient is overridden (useful for testing). */
  private resolveRecipient(to: string): string {
    const redirect = this.config.get<string>('MAIL_TEST_REDIRECT');
    return redirect && redirect.trim() ? redirect.trim() : to;
  }

  private logoAttachment() {
    const logoPath = path.join(process.cwd(), 'assets', 'logo-email.png');
    if (!fs.existsSync(logoPath)) {
      this.logger.warn(`Logo no encontrado en ${logoPath}; se enviará sin logo`);
      return [];
    }
    return [{ filename: 'logo.png', path: logoPath, cid: LOGO_CID }];
  }

  private async send(to: string, subject: string, html: string): Promise<boolean> {
    const recipient = this.resolveRecipient(to);
    if (!recipient?.trim()) {
      this.logger.warn(`Correo "${subject}" omitido: destinatario vacío`);
      return false;
    }
    try {
      const info = await this.mailer.sendMail({
        from: this.from,
        to: recipient,
        subject,
        html,
        attachments: this.logoAttachment(),
      });
      this.logger.log(`Correo enviado a ${recipient} (${subject}) — ${info?.messageId ?? 'ok'}`);
      return true;
    } catch (error) {
      this.logger.error(`Error enviando correo a ${recipient} (${subject})`, error as Error);
      return false;
    }
  }

  async sendResidentCredentials(
    to: string,
    params: Omit<CredentialsEmailParams, 'appName' | 'iosUrl' | 'huaweiUrl' | 'androidTestEmail'>,
  ): Promise<boolean> {
    const { subject, html } = renderCredentialsEmail({
      ...params,
      appName: this.appName,
      iosUrl: this.config.get<string>('MAIL_IOS_URL') || undefined,
      huaweiUrl: this.config.get<string>('MAIL_HUAWEI_URL') || undefined,
      androidTestEmail: this.config.get<string>('MAIL_ANDROID_TEST_EMAIL') || undefined,
    });
    return this.send(to, subject, html);
  }

  async sendRegistrationRejected(
    to: string,
    params: Omit<RejectionEmailParams, 'appName'>,
  ): Promise<boolean> {
    const { subject, html } = renderRejectionEmail({ ...params, appName: this.appName });
    return this.send(to, subject, html);
  }
}
