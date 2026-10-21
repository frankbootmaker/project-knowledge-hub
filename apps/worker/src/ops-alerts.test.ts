import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Database } from '@project-knowledge-hub/database';
import type { MailConfig } from '@project-knowledge-hub/mail';
import {
  BYTES_PER_GB,
  isBackupStale,
  isOffsiteBackupStale,
  runOpsAlerts,
  shouldAlertBackupFail,
  shouldAlertDiskLow,
  shouldAlertOffsiteError,
  shouldAlertRotationError,
  type OpsAlertMail,
  type OpsAlertRecipient,
  type OpsAlertType,
} from './ops-alerts.js';

const mailConfig: MailConfig = {
  driver: 'console',
  from: 'KnowHub <noreply@localhost>',
  webUrl: 'http://localhost:3100',
};

const database = {} as Database;

describe('ops alert helpers', () => {
  it('detects stale backups', () => {
    expect(isBackupStale(null, 36)).toBe(true);
    expect(isBackupStale(35 * 3600, 36)).toBe(false);
    expect(isBackupStale(37 * 3600, 36)).toBe(true);
  });

  it('alerts backup fail only when failure is newer than success', () => {
    expect(shouldAlertBackupFail({
      lastSuccessAt: null,
      lastFailureAt: '2026-07-24T12:00:00.000Z',
    })).toBe(true);
    expect(shouldAlertBackupFail({
      lastSuccessAt: '2026-07-24T13:00:00.000Z',
      lastFailureAt: '2026-07-24T12:00:00.000Z',
    })).toBe(false);
    expect(shouldAlertBackupFail({
      lastSuccessAt: '2026-07-24T11:00:00.000Z',
      lastFailureAt: '2026-07-24T12:00:00.000Z',
    })).toBe(true);
    expect(shouldAlertBackupFail({
      lastSuccessAt: '2026-07-24T12:00:00.000Z',
      lastFailureAt: null,
    })).toBe(false);
  });

  it('detects low disk by ratio or absolute bytes, whichever comes first', () => {
    expect(shouldAlertDiskLow({
      freeBytes: 5,
      totalBytes: 100,
      minFreeRatio: 0.1,
    })).toBe(true);
    expect(shouldAlertDiskLow({
      freeBytes: 20,
      totalBytes: 100,
      minFreeRatio: 0.1,
    })).toBe(false);
    expect(shouldAlertDiskLow({
      freeBytes: 1,
      totalBytes: 100,
      minFreeRatio: 0,
    })).toBe(false);

    const total = 50 * BYTES_PER_GB;
    const free = 8 * BYTES_PER_GB;
    expect(free / total).toBeGreaterThan(0.1);
    expect(shouldAlertDiskLow({
      freeBytes: free,
      totalBytes: total,
      minFreeRatio: 0.1,
      minFreeBytes: 10 * BYTES_PER_GB,
    })).toBe(true);
    expect(shouldAlertDiskLow({
      freeBytes: 12 * BYTES_PER_GB,
      totalBytes: total,
      minFreeRatio: 0.1,
      minFreeBytes: 10 * BYTES_PER_GB,
    })).toBe(false);
  });

  it('detects stale offsite copies, upload errors, and rotation errors', () => {
    expect(isOffsiteBackupStale(null, 48, false)).toBe(false);
    expect(isOffsiteBackupStale(null, 48, true)).toBe(true);
    expect(isOffsiteBackupStale(47 * 3600, 48, true)).toBe(false);
    expect(isOffsiteBackupStale(49 * 3600, 48, true)).toBe(true);
    expect(shouldAlertOffsiteError({
      errorAt: '2026-10-20T12:00:00.000Z',
      successAt: '2026-10-20T11:00:00.000Z',
    })).toBe(true);
    expect(shouldAlertOffsiteError({
      errorAt: '2026-10-20T10:00:00.000Z',
      successAt: '2026-10-20T11:00:00.000Z',
    })).toBe(false);
    expect(shouldAlertRotationError({ error: 'disk full', dryRun: false })).toBe(true);
    expect(shouldAlertRotationError({ error: 'disk full', dryRun: true })).toBe(false);
    expect(shouldAlertRotationError({ error: null, dryRun: false })).toBe(false);
    expect(shouldAlertRotationError(null)).toBe(false);
  });
});

describe('runOpsAlerts', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function tempDir(): Promise<string> {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'kh-ops-alerts-'));
    dirs.push(dir);
    return dir;
  }

  async function writeJson(dir: string, name: string, value: unknown): Promise<void> {
    await writeFile(path.join(dir, name), `${JSON.stringify(value)}\n`, 'utf8');
  }

  function capture() {
    const sent: OpsAlertMail[] = [];
    return {
      sent,
      sendMail: async (message: OpsAlertMail) => {
        sent.push(message);
      },
    };
  }

  const ops: OpsAlertRecipient = {
    email: 'ops@example.com',
    displayName: 'Ops',
    preferredLocale: 'en',
  };
  const admin: OpsAlertRecipient = {
    email: 'admin@example.com',
    displayName: 'Admin',
    preferredLocale: 'en',
  };

  async function run(input: {
    dir: string;
    recipients: Partial<Record<OpsAlertType, OpsAlertRecipient[]>>;
    sendMail: (message: OpsAlertMail) => Promise<void>;
    diskStats?: { freeBytes: number; totalBytes: number } | null;
    diskFreeRatioMin?: number;
    diskFreeGbMin?: number;
    offsiteEnabled?: boolean;
    offsiteStaleAfterHours?: number;
  }) {
    return runOpsAlerts({
      database,
      mailConfig,
      webUrl: 'http://localhost:3100',
      backupDir: input.dir,
      staleAfterHours: 36,
      offsiteStaleAfterHours: input.offsiteStaleAfterHours ?? 48,
      offsiteEnabled: input.offsiteEnabled ?? false,
      errorSpikeThreshold: 0,
      errorSpikeWindowMinutes: 15,
      diskFreeRatioMin: input.diskFreeRatioMin ?? 0,
      diskFreeGbMin: input.diskFreeGbMin ?? 0,
      diskStats: input.diskStats === undefined ? null : input.diskStats,
      resolveRecipients: async (type) => input.recipients[type] ?? [],
      sendMail: input.sendMail,
    });
  }

  it('emails only the configured disk.low recipients below 10 GB', async () => {
    const dir = await tempDir();
    await writeJson(dir, 'last-success.json', { at: new Date().toISOString() });
    const mail = capture();
    const results = await run({
      dir,
      recipients: { 'disk.low': [ops] },
      sendMail: mail.sendMail,
      diskFreeRatioMin: 0.1,
      diskFreeGbMin: 10,
      diskStats: {
        freeBytes: 8 * BYTES_PER_GB,
        totalBytes: Math.round(50.9 * BYTES_PER_GB),
      },
    });
    expect(results.find((row) => row.type === 'disk.low')).toMatchObject({
      alerted: true,
      reason: 'sent',
    });
    expect(mail.sent.map((row) => row.to)).toEqual(['ops@example.com']);
    expect(mail.sent[0]?.subject).toContain('disk space low');
    expect(mail.sent[0]?.text).toContain('8.0 GiB');
    expect(mail.sent.some((row) => row.to === admin.email)).toBe(false);

    mail.sent.length = 0;
    const again = await run({
      dir,
      recipients: { 'disk.low': [ops, admin] },
      sendMail: mail.sendMail,
      diskFreeRatioMin: 0.1,
      diskFreeGbMin: 10,
      diskStats: {
        freeBytes: 8 * BYTES_PER_GB,
        totalBytes: Math.round(50.9 * BYTES_PER_GB),
      },
    });
    expect(again.find((row) => row.type === 'disk.low')?.reason).toBe('already_alerted');
    expect(mail.sent).toHaveLength(0);
  });

  it('does not mark disk.low when nobody is configured to receive it', async () => {
    const dir = await tempDir();
    await writeJson(dir, 'last-success.json', { at: new Date().toISOString() });
    const mail = capture();
    const first = await run({
      dir,
      recipients: {},
      sendMail: mail.sendMail,
      diskFreeRatioMin: 0,
      diskFreeGbMin: 10,
      diskStats: { freeBytes: 8 * BYTES_PER_GB, totalBytes: 50 * BYTES_PER_GB },
    });
    expect(first.find((row) => row.type === 'disk.low')).toMatchObject({
      alerted: false,
      reason: 'no_recipients',
    });
    const second = await run({
      dir,
      recipients: { 'disk.low': [ops] },
      sendMail: mail.sendMail,
      diskFreeRatioMin: 0,
      diskFreeGbMin: 10,
      diskStats: { freeBytes: 8 * BYTES_PER_GB, totalBytes: 50 * BYTES_PER_GB },
    });
    expect(second.find((row) => row.type === 'disk.low')?.alerted).toBe(true);
    expect(mail.sent).toHaveLength(1);
  });

  it('sends one deduped email each for stale offsite, upload error, and rotation', async () => {
    const dir = await tempDir();
    const old = new Date(Date.now() - 49 * 3600 * 1000).toISOString();
    await writeJson(dir, 'last-success.json', { at: new Date().toISOString() });
    await writeJson(dir, 'last-offsite.json', {
      kind: 'offsite',
      at: old,
      artifact: 'knowledge-hub-old.dump',
      schemaVersion: 'test',
      hostname: 'test',
      key: 'backups/old.dump',
      provider: 's3',
    });
    await writeJson(dir, 'last-offsite-error.json', {
      kind: 'offsite_error',
      at: new Date().toISOString(),
      message: 'AccessDenied',
      artifact: 'knowledge-hub-old.dump',
    });
    await writeJson(dir, 'last-local-rotation.json', {
      kind: 'local_rotation',
      at: new Date().toISOString(),
      kept: null,
      deleted: null,
      error: 'permission denied',
      dryRun: false,
    });
    await writeJson(dir, 'last-s3-rotation.json', {
      kind: 's3_rotation',
      at: new Date().toISOString(),
      kept: 3,
      deleted: 1,
      error: null,
      dryRun: false,
    });

    const mail = capture();
    const recipients = {
      'offsite.stale': [ops],
      'offsite.error': [ops],
      'rotation.error': [admin],
    } satisfies Partial<Record<OpsAlertType, OpsAlertRecipient[]>>;
    const first = await run({
      dir,
      recipients,
      sendMail: mail.sendMail,
      offsiteEnabled: true,
      diskStats: null,
    });
    expect(first.find((row) => row.type === 'offsite.stale')?.alerted).toBe(true);
    expect(first.find((row) => row.type === 'offsite.error')?.alerted).toBe(true);
    expect(first.filter((row) => row.type === 'rotation.error' && row.alerted)).toHaveLength(1);
    expect(mail.sent).toHaveLength(3);
    expect(mail.sent.map((row) => row.to).sort()).toEqual([
      'admin@example.com',
      'ops@example.com',
      'ops@example.com',
    ]);
    expect(mail.sent.map((row) => row.subject).sort()).toEqual([
      'Backup rotation failed — KnowHub',
      'Offsite backup failed — KnowHub',
      'Offsite backup is stale — KnowHub',
    ]);

    mail.sent.length = 0;
    const second = await run({
      dir,
      recipients,
      sendMail: mail.sendMail,
      offsiteEnabled: true,
      diskStats: null,
    });
    expect(second.filter((row) => row.alerted)).toHaveLength(0);
    expect(mail.sent).toHaveLength(0);
  });
});
