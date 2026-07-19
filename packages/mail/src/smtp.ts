import nodemailer from 'nodemailer';
import type { MailConfig, MailMessage, MailSendResult, MailTransport } from './types.js';

export class SmtpMailTransport implements MailTransport {
  readonly driver = 'smtp';
  private readonly from: string;
  private readonly transporter: nodemailer.Transporter;

  constructor(config: NonNullable<MailConfig['smtp']> & { from: string }) {
    this.from = config.from;
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth:
        config.user && config.pass
          ? { user: config.user, pass: config.pass }
          : undefined,
    });
  }

  async send(message: MailMessage): Promise<MailSendResult> {
    try {
      await this.transporter.sendMail({
        from: this.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
      return { ok: true, driver: this.driver };
    } catch (error) {
      return {
        ok: false,
        driver: this.driver,
        error: error instanceof Error ? error.message : 'SMTP send failed',
      };
    }
  }
}
