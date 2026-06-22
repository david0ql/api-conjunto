import { Global, Module } from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';
import { ConfigService } from '@nestjs/config';
import { MailService, MAILER_PROVIDER } from './mail.service';

@Global()
@Module({
  providers: [
    {
      provide: MAILER_PROVIDER,
      useFactory: (config: ConfigService) =>
        new MailerService(
          {
            transport: {
              pool: true,
              maxConnections: 5,
              host: config.get<string>('MAIL_HOST'),
              port: Number(config.get<string>('MAIL_PORT')) || 587,
              secure: config.get<string>('MAIL_SECURE') === 'true',
              auth: {
                user: config.get<string>('MAIL_USER'),
                pass: config.get<string>('MAIL_PASS'),
              },
              tls: { rejectUnauthorized: false },
            },
            defaults: {
              from: config.get<string>('MAIL_FROM') || config.get<string>('MAIL_USER'),
            },
          },
          null as never,
        ),
      inject: [ConfigService],
    },
    MailService,
  ],
  exports: [MailService],
})
export class MailModule {}
