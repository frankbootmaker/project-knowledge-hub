import { describe, expect, it } from 'vitest';
import {
  inviteEmail,
  passwordResetEmail,
  emailConfirmEmail,
  accountApprovedEmail,
  passwordChangedEmail,
  accountClosedEmail,
  signupRejectedEmail,
  signupPendingApprovalEmail,
  ssoUserProvisionedEmail,
  signupPendingEscalationEmail,
  backupStaleAlertEmail,
  opsAlertEmail,
  aiConnectionPendingEmail,
  aiConnectionApprovedEmail,
  aiConnectionRejectedEmail,
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
    expect(mail.html).toContain('KnowHub');
    expect(mail.html).toMatch(/>\s*KH\s*</);
    expect(mail.html).toContain('#111811');
    expect(mail.html).toContain('#121c23');
    expect(mail.html).not.toContain('IN3 Technology');
    expect(mail.html).not.toContain('#1f4b73');
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

  it('uses KnowHub ops chrome on every product and test template', () => {
    const samples = [
      passwordResetEmail({
        locale: 'en',
        displayName: 'Ada',
        actionUrl: 'http://localhost:3100/set-password?token=t',
      }),
      inviteEmail({
        locale: 'de',
        displayName: 'Ada',
        actionUrl: 'http://localhost:3100/set-password?token=t',
      }),
      emailConfirmEmail({
        locale: 'hu',
        displayName: 'Ada',
        actionUrl: 'http://localhost:3100/confirm-email?token=t',
      }),
      accountApprovedEmail({
        displayName: 'Ada',
        loginUrl: 'http://localhost:3100/login',
      }),
      passwordChangedEmail({
        locale: 'en',
        displayName: 'Ada',
        loginUrl: 'http://localhost:3100/login',
      }),
      accountClosedEmail({ locale: 'en', displayName: 'Ada' }),
      signupRejectedEmail({ locale: 'en', displayName: 'Ada' }),
      signupPendingApprovalEmail({
        displayName: 'Ada',
        signupDisplayName: 'Ada',
        signupEmail: 'ada@example.com',
        reviewUrl: 'http://localhost:3100/admin/users',
      }),
      ssoUserProvisionedEmail({
        displayName: 'Ada',
        signupDisplayName: 'Ada',
        signupEmail: 'ada@example.com',
        reviewUrl: 'http://localhost:3100/admin/users',
      }),
      signupPendingEscalationEmail({
        displayName: 'Ada',
        signupDisplayName: 'Ada',
        signupEmail: 'ada@example.com',
        pendingSince: '2026-08-01',
        pendingAge: '2d',
        reviewUrl: 'http://localhost:3100/admin/users',
      }),
      backupStaleAlertEmail({
        displayName: 'Ada',
        ageLabel: '26h',
        staleAfterHours: 24,
        monitoringUrl: 'http://localhost:3100/admin/monitoring',
      }),
      opsAlertEmail({
        displayName: 'Ada',
        subject: 'KnowHub — ops',
        title: 'Ops alert',
        body: 'Check monitoring.',
        monitoringUrl: 'http://localhost:3100/admin/monitoring',
      }),
      aiConnectionPendingEmail({
        displayName: 'Ada',
        agentName: 'Cursor',
        manageUrl: 'http://localhost:3100/account/ai-connections',
      }),
      aiConnectionApprovedEmail({
        displayName: 'Ada',
        agentName: 'Cursor',
        manageUrl: 'http://localhost:3100/account/ai-connections',
      }),
      aiConnectionRejectedEmail({
        displayName: 'Ada',
        agentName: 'Cursor',
        manageUrl: 'http://localhost:3100/account/ai-connections',
      }),
      testEmail({
        locale: 'en',
        displayName: 'Ada',
        driver: 'console',
        source: 'env',
        from: 'hub@example.com',
        settingsUrl: 'http://localhost:3100/admin/email',
      }),
    ];

    for (const mail of samples) {
      expect(mail.html).toContain('KnowHub');
      expect(mail.html).toMatch(/>\s*KH\s*</);
      expect(mail.html).toContain('#111811');
      expect(mail.html).toContain('#121c23');
      expect(mail.html).toContain("IBM Plex Sans");
      expect(mail.html).not.toContain('IN3 Technology');
      expect(mail.html).not.toContain('Project Knowledge Hub');
      expect(mail.html).not.toContain('#1f4b73');
    }
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
    expect(mail.subject).toMatch(/KnowHub/i);
    expect(mail.subject).toMatch(/test email/i);
    expect(mail.html).toContain('KnowHub');
    expect(mail.html).toMatch(/>\s*KH\s*</);
    expect(mail.html).not.toContain('IN3 Technology');
    expect(mail.html).toContain('Driver: console');
    expect(mail.html).toContain('href="http://localhost:3100/admin/email"');
    expect(mail.text).toContain('hub@example.com');
  });
});
