import { describe, expect, it } from 'vitest';
import { createMailTransport } from './create-transport.js';
import { ConsoleMailTransport } from './console.js';
import { SmtpMailTransport } from './smtp.js';
import { ResendMailTransport } from './resend.js';

describe('createMailTransport', () => {
  it('returns console transport by default driver', () => {
    const transport = createMailTransport({
      driver: 'console',
      from: 'hub@example.com',
      webUrl: 'http://localhost:3100',
    });
    expect(transport).toBeInstanceOf(ConsoleMailTransport);
    expect(transport.driver).toBe('console');
  });

  it('returns smtp transport when configured', () => {
    const transport = createMailTransport({
      driver: 'smtp',
      from: 'hub@example.com',
      webUrl: 'http://localhost:3100',
      smtp: {
        host: 'smtp.example.com',
        port: 587,
        secure: false,
        user: 'u',
        pass: 'p',
      },
    });
    expect(transport).toBeInstanceOf(SmtpMailTransport);
  });

  it('returns resend transport when configured', () => {
    const transport = createMailTransport({
      driver: 'resend',
      from: 'hub@example.com',
      webUrl: 'http://localhost:3100',
      resendApiKey: 're_test',
    });
    expect(transport).toBeInstanceOf(ResendMailTransport);
  });

  it('rejects smtp without host', () => {
    expect(() =>
      createMailTransport({
        driver: 'smtp',
        from: 'hub@example.com',
        webUrl: 'http://localhost:3100',
      }),
    ).toThrow(/SMTP_HOST/);
  });
});
