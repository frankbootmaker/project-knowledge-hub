import { describe, expect, it } from 'vitest';
import {
  mergeStoredOpsAlertSettings,
  parseStoredOpsAlertSettings,
  recipientsFromSpec,
  resolveEffectiveAlertSettings,
  type AlertEnvSource,
  type AlertRecipient,
} from './ops-alert-settings.js';

const env: AlertEnvSource = {
  ALERT_DISK_FREE_RATIO_MIN: 0.1,
  ALERT_DISK_FREE_GB_MIN: 10,
  BACKUP_STALE_AFTER_HOURS: 36,
  BACKUP_OFFSITE_STALE_AFTER_HOURS: 48,
  ALERT_ERROR_SPIKE_THRESHOLD: 50,
  ALERT_ERROR_SPIKE_WINDOW_MINUTES: 15,
  ALERT_WEBHOOK_URL: 'https://hooks.example/ops',
  AUDIT_RETENTION_DAYS: 90,
  AUDIT_RETENTION_INTERVAL_MS: 86_400_000,
};

const admin: AlertRecipient = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  email: 'admin@example.com',
  displayName: 'Admin',
  preferredLocale: 'en',
};

const ops: AlertRecipient = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  email: 'ops@example.com',
  displayName: 'Ops',
  preferredLocale: 'de',
};

describe('ops alert settings', () => {
  it('keeps env thresholds and admin fallback until a row is stored', () => {
    const effective = resolveEffectiveAlertSettings(null, env);
    expect(effective.source).toBe('env');
    expect(effective.diskFreeGbMin).toBe(10);
    expect(effective.diskFreeRatioMin).toBe(0.1);
    expect(effective.auditRetentionDays).toBe(90);
    expect(effective.auditRetentionSource).toBe('env');
    expect(effective.webhookUrl).toBe('https://hooks.example/ops');
    expect(effective.webhookMode).toBe('env');

    const plan = recipientsFromSpec({
      spec: undefined,
      admins: [admin],
      selectedUsers: [ops],
    });
    expect(plan.source).toBe('admins');
    expect(plan.recipients.map((row) => row.email)).toEqual(['admin@example.com']);
  });

  it('lets a saved row override thresholds, webhook, and retention days', () => {
    const stored = parseStoredOpsAlertSettings(JSON.stringify({
      diskFreeGbMin: 20,
      diskFreeRatioMin: 0,
      auditRetentionDays: 0,
      webhookMode: 'disabled',
      webhookUrl: 'https://ignored.example',
      staleAfterHours: 12,
    }));
    const effective = resolveEffectiveAlertSettings(stored, env);
    expect(effective.source).toBe('override');
    expect(effective.diskFreeGbMin).toBe(20);
    expect(effective.diskFreeRatioMin).toBe(0);
    expect(effective.auditRetentionDays).toBe(0);
    expect(effective.auditRetentionSource).toBe('override');
    expect(effective.webhookUrl).toBeUndefined();
    expect(effective.webhookMode).toBe('disabled');
    expect(effective.staleAfterHours).toBe(12);
    expect(effective.offsiteStaleAfterHours).toBe(48);
  });

  it('ignores out-of-range stored numbers and falls back to env', () => {
    const stored = parseStoredOpsAlertSettings(JSON.stringify({
      diskFreeGbMin: -1,
      auditRetentionDays: 99999,
      staleAfterHours: 'nope',
    }));
    const effective = resolveEffectiveAlertSettings(stored, env);
    expect(effective.diskFreeGbMin).toBe(10);
    expect(effective.auditRetentionDays).toBe(90);
    expect(effective.staleAfterHours).toBe(36);
  });

  it('sends only the configured users and extra addresses', () => {
    const plan = recipientsFromSpec({
      spec: {
        configured: true,
        userIds: [ops.id!],
        emails: ['Extra@Example.com', 'ops@example.com'],
      },
      admins: [admin],
      selectedUsers: [ops, admin],
    });
    expect(plan.source).toBe('custom');
    expect(plan.recipients.map((row) => row.email)).toEqual([
      'ops@example.com',
      'extra@example.com',
    ]);
  });

  it('sends to nobody when a type is configured with an empty list', () => {
    const plan = recipientsFromSpec({
      spec: { configured: true, userIds: [], emails: [] },
      admins: [admin],
      selectedUsers: [],
    });
    expect(plan.source).toBe('custom');
    expect(plan.recipients).toEqual([]);
  });

  it('treats configured false as the admin fallback', () => {
    const plan = recipientsFromSpec({
      spec: {
        configured: false,
        userIds: [ops.id!],
        emails: ['extra@example.com'],
      },
      admins: [admin],
      selectedUsers: [ops],
    });
    expect(plan.source).toBe('admins');
    expect(plan.recipients.map((row) => row.email)).toEqual(['admin@example.com']);
  });

  it('keeps alert settings on the environment when only retention is saved', () => {
    const stored = mergeStoredOpsAlertSettings(null, { auditRetentionDays: 30 });
    const effective = resolveEffectiveAlertSettings(stored, env);
    expect(effective.source).toBe('env');
    expect(effective.diskFreeGbMin).toBe(10);
    expect(effective.auditRetentionDays).toBe(30);
    expect(effective.auditRetentionSource).toBe('override');
  });

  it('clears retention without dropping saved alert thresholds', () => {
    const stored = mergeStoredOpsAlertSettings(
      { diskFreeGbMin: 20, auditRetentionDays: 30 },
      { auditRetentionDays: null },
    );
    const effective = resolveEffectiveAlertSettings(stored, env);
    expect(stored).toEqual({ diskFreeGbMin: 20 });
    expect(effective.source).toBe('override');
    expect(effective.auditRetentionDays).toBe(90);
    expect(effective.auditRetentionSource).toBe('env');
  });
});
