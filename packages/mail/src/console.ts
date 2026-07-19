import type { MailMessage, MailSendResult, MailTransport } from './types.js';

export class ConsoleMailTransport implements MailTransport {
  readonly driver = 'console';

  async send(message: MailMessage): Promise<MailSendResult> {
    console.info(
      [
        '[mail:console]',
        `to=${message.to}`,
        `subject=${message.subject}`,
        '---',
        message.text,
        '---',
      ].join('\n'),
    );
    return { ok: true, driver: this.driver };
  }
}
