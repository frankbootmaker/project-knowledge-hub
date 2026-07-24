import { describe, expect, it } from 'vitest';
import {
  inviteEmail,
  passwordResetEmail,
  emailConfirmEmail,
  accountApprovedEmail,
  passwordChangedEmail,
  accountClosedEmail,
  aiConnectionPendingEmail,
  testEmail,
  setPasswordUrl,
  confirmEmailUrl,
} from './templates.js';

describe('mail templates', () => {
  it('builds set-password URL with token', () => {
    expect(setPasswordUrl('http://localhost:3100/', 'abc123')).toBe(
      'http://localhost:3100/set-password?token=abc123',
    );
  });

  it('builds confirm-email URL with token', () => {
    expect(confirmEmailUrl('http://localhost:3100/', 'abc123')).toBe(
      'http://localhost:3100/confirm-email?token=abc123',
    );
  });

  it('includes branded layout and action link in password reset', () => {
    const mail = passwordResetEmail({
      locale: 'en',
      displayName: 'Ada',
      actionUrl: 'http://localhost:3100/set-password?token=t',
    });
    expect(mail.subject).toMatch(/password/i);
    expect(mail.html).toContain('IN3 Technology');
    expect(mail.html).toContain('Project Knowledge Hub');
    expect(mail.html).toContain('href="http://localhost:3100/set-password?token=t"');
    expect(mail.text).toContain('http://localhost:3100/set-password?token=t');
  });

  it('localizes password reset to German', () => {
    const mail = passwordResetEmail({
      locale: 'de',
      displayName: 'Ada',
      actionUrl: 'http://localhost:3100/set-password?token=t',
    });
    expect(mail.subject).toMatch(/Passwort/i);
    expect(mail.html).toContain('lang="de"');
    expect(mail.html).toContain('Neues Passwort wählen');
  });

  it('localizes invite to Hungarian', () => {
    const mail = inviteEmail({
      locale: 'hu',
      displayName: 'Ada',
      actionUrl: 'http://localhost:3100/set-password?token=t',
    });
    expect(mail.subject).toMatch(/Meghívó/i);
    expect(mail.html).toContain('Jelszó beállítása');
  });

  it('includes action link in email confirm content', () => {
    const mail = emailConfirmEmail({
      displayName: 'Ada',
      actionUrl: 'http://localhost:3100/confirm-email?token=t',
    });
    expect(mail.subject).toMatch(/confirm/i);
    expect(mail.text).toContain('Confirm your email address');
    expect(mail.text).toMatch(/workspace/i);
  });

  it('lists memberships in account approved mail', () => {
    const mail = accountApprovedEmail({
      displayName: 'Ada',
      loginUrl: 'http://localhost:3100/login',
      memberships: [
        { workspaceName: 'Demo', role: 'maintainer' },
        { workspaceName: 'Ops', role: 'reader' },
      ],
    });
    expect(mail.html).toContain('Demo');
    expect(mail.html).toContain('Ops');
    expect(mail.text).toContain('Maintainer');
  });

  it('renders password-changed and account-closed notices', () => {
    const changed = passwordChangedEmail({
      locale: 'en',
      displayName: 'Ada',
      loginUrl: 'http://localhost:3100/login',
    });
    expect(changed.subject).toMatch(/changed/i);
    expect(changed.html).toContain('Password changed');

    const closed = accountClosedEmail({
      locale: 'de',
      displayName: 'Ada',
    });
    expect(closed.subject).toMatch(/geschlossen/i);
  });

  it('renders AI pending notice with agent label', () => {
    const mail = aiConnectionPendingEmail({
      locale: 'en',
      displayName: 'Ada',
      agentName: 'Cursor',
      manageUrl: 'http://localhost:3100/account/ai-connections',
    });
    expect(mail.html).toContain('Cursor');
    expect(mail.html).toContain('/account/ai-connections');
  });

  it('renders branded test email with driver metadata', () => {
    const mail = testEmail({
      locale: 'en',
      displayName: 'Ada',
      driver: 'console',
      source: 'env',
      from: 'hub@example.com',
      settingsUrl: 'http://localhost:3100/admin/email',
    });
    expect(mail.subject).toMatch(/test email/i);
    expect(mail.html).toContain('IN3 Technology');
    expect(mail.html).toContain('Driver: console');
    expect(mail.html).toContain('href="http://localhost:3100/admin/email"');
    expect(mail.text).toContain('hub@example.com');
  });
});
