import type { MailConfig, MailMessage, MailSendResult, MailTransport } from './types.js';

export class ResendMailTransport implements MailTransport {
  readonly driver = 'resend';
  private readonly from: string;
  private readonly apiKey: string;

  constructor(config: { from: string; apiKey: string }) {
    this.from = config.from;
    this.apiKey = config.apiKey;
  }

  async send(message: MailMessage): Promise<MailSendResult> {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.from,
          to: [message.to],
          subject: message.subject,
          text: message.text,
          html: message.html,
        }),
      });
      if (!response.ok) {
        const body = await response.text();
        return {
          ok: false,
          driver: this.driver,
          error: `Resend HTTP ${response.status}: ${body.slice(0, 200)}`,
        };
      }
      return { ok: true, driver: this.driver };
    } catch (error) {
      return {
        ok: false,
        driver: this.driver,
        error: error instanceof Error ? error.message : 'Resend send failed',
      };
    }
  }
}

export function assertResendConfig(
  config: MailConfig,
): asserts config is MailConfig & { resendApiKey: string } {
  if (!config.resendApiKey) {
    throw new Error('RESEND_API_KEY is required when MAIL_DRIVER=resend');
  }
}
