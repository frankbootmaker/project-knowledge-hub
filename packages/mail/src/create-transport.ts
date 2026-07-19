import { ConsoleMailTransport } from './console.js';
import { assertResendConfig, ResendMailTransport } from './resend.js';
import { SmtpMailTransport } from './smtp.js';
import type { MailConfig, MailTransport } from './types.js';

export function createMailTransport(config: MailConfig): MailTransport {
  if (config.driver === 'console') {
    return new ConsoleMailTransport();
  }

  if (config.driver === 'smtp') {
    if (!config.smtp?.host) {
      throw new Error('SMTP_HOST is required when MAIL_DRIVER=smtp');
    }
    return new SmtpMailTransport({
      from: config.from,
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      user: config.smtp.user,
      pass: config.smtp.pass,
    });
  }

  if (config.driver === 'resend') {
    assertResendConfig(config);
    return new ResendMailTransport({
      from: config.from,
      apiKey: config.resendApiKey,
    });
  }

  throw new Error(`Unknown mail driver: ${String((config as MailConfig).driver)}`);
}
