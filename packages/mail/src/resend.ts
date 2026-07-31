import type { MailConfig, MailMessage, MailSendResult, MailTransport } from './types.js';

export const DEFAULT_RESEND_BASE_URL = 'https://api.resend.com';

/** Strip trailing slash and optional `/emails` so Freeresend/custom hosts work. */
export function normalizeResendBaseUrl(raw?: string | null): string {
  const trimmed = (raw ?? '').trim() || DEFAULT_RESEND_BASE_URL;
  return trimmed.replace(/\/+$/, '').replace(/\/emails$/i, '');
}

export class ResendMailTransport implements MailTransport {
  readonly driver = 'resend';
  private readonly from: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: { from: string; apiKey: string; baseUrl?: string }) {
    this.from = config.from;
    this.apiKey = config.apiKey;
    this.baseUrl = normalizeResendBaseUrl(config.baseUrl);
  }

  async send(message: MailMessage): Promise<MailSendResult> {
    try {
      const response = await fetch(`${this.baseUrl}/emails`, {
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
  if (config.resendBaseUrl?.trim()) {
    try {
      const parsed = new URL(normalizeResendBaseUrl(config.resendBaseUrl));
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('invalid protocol');
      }
    } catch {
      throw new Error(
        'RESEND_BASE_URL must be an http(s) origin (e.g. https://api.resend.com or a Freeresend host)',
      );
    }
  }
}
