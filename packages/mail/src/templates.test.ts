import { describe, expect, it } from 'vitest';
import { inviteEmail, passwordResetEmail, setPasswordUrl } from './templates.js';

describe('mail templates', () => {
  it('builds set-password URL with token', () => {
    expect(setPasswordUrl('http://localhost:3100/', 'abc123')).toBe(
      'http://localhost:3100/set-password?token=abc123',
    );
  });

  it('includes action link in password reset content', () => {
    const mail = passwordResetEmail({
      displayName: 'Ada',
      actionUrl: 'http://localhost:3100/set-password?token=t',
    });
    expect(mail.subject).toMatch(/password/i);
    expect(mail.text).toContain('http://localhost:3100/set-password?token=t');
    expect(mail.html).toContain('href="http://localhost:3100/set-password?token=t"');
  });

  it('includes action link in invite content', () => {
    const mail = inviteEmail({
      displayName: 'Ada',
      actionUrl: 'http://localhost:3100/set-password?token=t',
    });
    expect(mail.subject).toMatch(/invited/i);
    expect(mail.text).toContain('set your password');
  });
});
