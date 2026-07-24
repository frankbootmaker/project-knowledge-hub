import { promises as fs } from 'node:fs';
import path from 'node:path';
import { and, count, eq, gte, sql } from 'drizzle-orm';
import { auditEvents, users, type Database } from '@project-knowledge-hub/database';
import {
  adminMonitoringUrl,
  backupStaleAlertEmail,
  createMailTransport,
  getMailMessages,
  interpolate,
  normalizeAppLocale,
  opsAlertEmail,
  type MailConfig,
} from '@project-knowledge-hub/mail';

export type OpsAlertType =
  | 'backup.stale'
  | 'backup.fail'
  | 'api.error_spike'
  | 'disk.low';

type AlertStateEntry = {
  at: string;
  fingerprint: string;
};

type AlertState = Partial<Record<OpsAlertType, AlertStateEntry>>;

const STATE_FILE = 'ops-alerts-state.json';
/** Legacy stamp from the first NF-009 slice — still honored for backup.stale. */
const LEGACY_STALE_FILE = 'last-stale-alert.json';

function formatAge(ageSeconds: number | null): string {
  if (ageSeconds == null) return 'never (no last-success stamp)';
  const hours = Math.max(1, Math.floor(ageSeconds / 3600));
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

export function isBackupStale(
  ageSeconds: number | null,
  staleAfterHours: number,
): boolean {
  if (ageSeconds == null) return true;
  return ageSeconds > staleAfterHours * 3600;
}

export function shouldAlertBackupFail(input: {
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
}): boolean {
  if (!input.lastFailureAt) return false;
  if (!input.lastSuccessAt) return true;
  return new Date(input.lastFailureAt).getTime() > new Date(input.lastSuccessAt).getTime();
}

export function shouldAlertDiskLow(input: {
  freeBytes: number;
  totalBytes: number;
  minFreeRatio: number;
}): boolean {
  if (input.minFreeRatio <= 0) return false;
  if (input.totalBytes <= 0) return false;
  return input.freeBytes / input.totalBytes < input.minFreeRatio;
}

async function readStampAt(
  backupDir: string,
  fileName: string,
): Promise<{ at: string | null; ageSeconds: number | null }> {
  try {
    const raw = await fs.readFile(path.join(backupDir, fileName), 'utf8');
    const parsed = JSON.parse(raw) as { at?: string };
    if (!parsed.at || typeof parsed.at !== 'string') {
      return { at: null, ageSeconds: null };
    }
    const ageSeconds = Math.max(
      0,
      Math.floor((Date.now() - new Date(parsed.at).getTime()) / 1000),
    );
    return { at: parsed.at, ageSeconds };
  } catch {
    return { at: null, ageSeconds: null };
  }
}

async function readAlertState(backupDir: string): Promise<AlertState> {
  try {
    const raw = await fs.readFile(path.join(backupDir, STATE_FILE), 'utf8');
    const parsed = JSON.parse(raw) as AlertState;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    // Migrate legacy stale stamp into state so we do not re-spam after upgrade.
    try {
      const legacyRaw = await fs.readFile(
        path.join(backupDir, LEGACY_STALE_FILE),
        'utf8',
      );
      const legacy = JSON.parse(legacyRaw) as {
        at?: string;
        lastSuccessAt?: string | null;
        staleAfterHours?: number;
      };
      if (legacy.at && typeof legacy.at === 'string') {
        return {
          'backup.stale': {
            at: legacy.at,
            fingerprint: `${legacy.lastSuccessAt ?? 'null'}|${legacy.staleAfterHours ?? 0}`,
          },
        };
      }
    } catch {
      // ignore
    }
    return {};
  }
}

async function writeAlertState(backupDir: string, state: AlertState): Promise<void> {
  await fs.mkdir(backupDir, { recursive: true });
  await fs.writeFile(
    path.join(backupDir, STATE_FILE),
    `${JSON.stringify(state, null, 2)}\n`,
    'utf8',
  );
}

async function postWebhook(
  webhookUrl: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'project-knowledge-hub-ops-alert/1',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`Alert webhook HTTP ${response.status}`);
  }
}

async function listActiveAdmins(database: Database): Promise<
  Array<{
    displayName: string;
    email: string;
    preferredLocale: string | null;
  }>
> {
  return database.db
    .select({
      displayName: users.displayName,
      email: users.email,
      preferredLocale: users.preferredLocale,
    })
    .from(users)
    .where(and(eq(users.isSystemAdmin, true), eq(users.status, 'active')));
}

async function dispatchAlert(input: {
  database: Database;
  mailConfig: MailConfig;
  webhookUrl?: string;
  type: OpsAlertType;
  webhookPayload: Record<string, unknown>;
  buildEmail: (locale: string | null, displayName: string) => {
    subject: string;
    html: string;
    text: string;
  };
}): Promise<'sent' | 'no_admins'> {
  if (input.webhookUrl) {
    await postWebhook(input.webhookUrl, input.webhookPayload);
  }

  const admins = await listActiveAdmins(input.database);
  if (admins.length === 0) {
    return input.webhookUrl ? 'sent' : 'no_admins';
  }

  const mail = createMailTransport(input.mailConfig);
  await Promise.all(
    admins.map(async (admin) => {
      const content = input.buildEmail(admin.preferredLocale, admin.displayName);
      await mail.send({
        to: admin.email,
        subject: content.subject,
        html: content.html,
        text: content.text,
      });
    }),
  );
  return 'sent';
}

async function countErrorLikeAudits(
  database: Database,
  since: Date,
): Promise<number> {
  const [row] = await database.db
    .select({ value: count() })
    .from(auditEvents)
    .where(
      and(
        gte(auditEvents.createdAt, since),
        sql`(
          ${auditEvents.action} ILIKE '%error%'
          OR ${auditEvents.action} ILIKE '%fail%'
          OR ${auditEvents.action} = 'mcp.tool_error'
        )`,
      ),
    );
  return Number(row?.value ?? 0);
}

async function readDiskStats(backupDir: string): Promise<{
  freeBytes: number;
  totalBytes: number;
} | null> {
  try {
    await fs.mkdir(backupDir, { recursive: true });
    const stats = await fs.statfs(backupDir);
    const blockSize = Number(stats.bsize);
    const totalBytes = Number(stats.blocks) * blockSize;
    const freeBytes = Number(stats.bavail) * blockSize;
    if (!Number.isFinite(totalBytes) || totalBytes <= 0) return null;
    return { freeBytes, totalBytes };
  } catch {
    return null;
  }
}

export type OpsAlertRunResult = {
  type: OpsAlertType;
  alerted: boolean;
  reason: string;
};

/**
 * NF-009 — email system admins (+ optional webhook) for ops conditions.
 * Dedupes per alert type via BACKUP_DIR/ops-alerts-state.json fingerprints.
 */
export async function runOpsAlerts(input: {
  database: Database;
  mailConfig: MailConfig;
  webUrl: string;
  backupDir: string;
  staleAfterHours: number;
  webhookUrl?: string;
  errorSpikeThreshold: number;
  errorSpikeWindowMinutes: number;
  diskFreeRatioMin: number;
}): Promise<OpsAlertRunResult[]> {
  const monitoringUrl = adminMonitoringUrl(input.webUrl);
  const state = await readAlertState(input.backupDir);
  const results: OpsAlertRunResult[] = [];

  const mark = async (type: OpsAlertType, fingerprint: string) => {
    state[type] = { at: new Date().toISOString(), fingerprint };
    await writeAlertState(input.backupDir, state);
  };

  const already = (type: OpsAlertType, fingerprint: string) =>
    state[type]?.fingerprint === fingerprint;

  // --- backup.stale ---
  {
    const { at: lastSuccessAt, ageSeconds } = await readStampAt(
      input.backupDir,
      'last-success.json',
    );
    if (!isBackupStale(ageSeconds, input.staleAfterHours)) {
      results.push({ type: 'backup.stale', alerted: false, reason: 'fresh' });
    } else {
      const fingerprint = `${lastSuccessAt ?? 'null'}|${input.staleAfterHours}`;
      if (already('backup.stale', fingerprint)) {
        results.push({
          type: 'backup.stale',
          alerted: false,
          reason: 'already_alerted',
        });
      } else {
        const ageLabel = formatAge(ageSeconds);
        const outcome = await dispatchAlert({
          database: input.database,
          mailConfig: input.mailConfig,
          webhookUrl: input.webhookUrl,
          type: 'backup.stale',
          webhookPayload: {
            type: 'backup.stale',
            generatedAt: new Date().toISOString(),
            lastSuccessAt,
            ageSeconds,
            ageLabel,
            staleAfterHours: input.staleAfterHours,
            monitoringUrl,
          },
          buildEmail: (locale, displayName) =>
            backupStaleAlertEmail({
              locale,
              displayName,
              ageLabel,
              staleAfterHours: input.staleAfterHours,
              monitoringUrl,
            }),
        });
        if (outcome === 'no_admins') {
          results.push({
            type: 'backup.stale',
            alerted: false,
            reason: 'no_admins',
          });
        } else {
          await mark('backup.stale', fingerprint);
          results.push({ type: 'backup.stale', alerted: true, reason: 'sent' });
        }
      }
    }
  }

  // --- backup.fail ---
  {
    const { at: lastSuccessAt } = await readStampAt(
      input.backupDir,
      'last-success.json',
    );
    const { at: lastFailureAt } = await readStampAt(
      input.backupDir,
      'last-failure.json',
    );
    if (!shouldAlertBackupFail({ lastSuccessAt, lastFailureAt })) {
      results.push({ type: 'backup.fail', alerted: false, reason: 'ok' });
    } else {
      const fingerprint = lastFailureAt ?? 'unknown';
      if (already('backup.fail', fingerprint)) {
        results.push({
          type: 'backup.fail',
          alerted: false,
          reason: 'already_alerted',
        });
      } else {
        const outcome = await dispatchAlert({
          database: input.database,
          mailConfig: input.mailConfig,
          webhookUrl: input.webhookUrl,
          type: 'backup.fail',
          webhookPayload: {
            type: 'backup.fail',
            generatedAt: new Date().toISOString(),
            lastSuccessAt,
            lastFailureAt,
            monitoringUrl,
          },
          buildEmail: (locale, displayName) => {
            const loc = normalizeAppLocale(locale);
            const copy = getMailMessages(loc).opsAlertBackupFail;
            const failureLine = interpolate(copy.failureAtLabel, {
              at: lastFailureAt ?? 'unknown',
            });
            return opsAlertEmail({
              locale,
              displayName,
              subject: copy.subject,
              title: copy.title,
              body: copy.body,
              detailLines: [failureLine],
              monitoringUrl,
            });
          },
        });
        if (outcome === 'no_admins') {
          results.push({
            type: 'backup.fail',
            alerted: false,
            reason: 'no_admins',
          });
        } else {
          await mark('backup.fail', fingerprint);
          results.push({ type: 'backup.fail', alerted: true, reason: 'sent' });
        }
      }
    }
  }

  // --- api.error_spike ---
  if (input.errorSpikeThreshold <= 0) {
    results.push({
      type: 'api.error_spike',
      alerted: false,
      reason: 'disabled',
    });
  } else {
    const windowMs = input.errorSpikeWindowMinutes * 60 * 1000;
    const since = new Date(Date.now() - windowMs);
    const errorCount = await countErrorLikeAudits(input.database, since);
    if (errorCount < input.errorSpikeThreshold) {
      results.push({
        type: 'api.error_spike',
        alerted: false,
        reason: 'below_threshold',
      });
    } else {
      const bucket = Math.floor(Date.now() / windowMs);
      const fingerprint = `${bucket}|${input.errorSpikeThreshold}`;
      if (already('api.error_spike', fingerprint)) {
        results.push({
          type: 'api.error_spike',
          alerted: false,
          reason: 'already_alerted',
        });
      } else {
        const outcome = await dispatchAlert({
          database: input.database,
          mailConfig: input.mailConfig,
          webhookUrl: input.webhookUrl,
          type: 'api.error_spike',
          webhookPayload: {
            type: 'api.error_spike',
            generatedAt: new Date().toISOString(),
            errorCount,
            threshold: input.errorSpikeThreshold,
            windowMinutes: input.errorSpikeWindowMinutes,
            monitoringUrl,
          },
          buildEmail: (locale, displayName) => {
            const loc = normalizeAppLocale(locale);
            const copy = getMailMessages(loc).opsAlertErrorSpike;
            const countLine = interpolate(copy.countLabel, {
              count: String(errorCount),
              minutes: String(input.errorSpikeWindowMinutes),
              threshold: String(input.errorSpikeThreshold),
            });
            return opsAlertEmail({
              locale,
              displayName,
              subject: copy.subject,
              title: copy.title,
              body: copy.body,
              detailLines: [countLine],
              monitoringUrl,
            });
          },
        });
        if (outcome === 'no_admins') {
          results.push({
            type: 'api.error_spike',
            alerted: false,
            reason: 'no_admins',
          });
        } else {
          await mark('api.error_spike', fingerprint);
          results.push({
            type: 'api.error_spike',
            alerted: true,
            reason: 'sent',
          });
        }
      }
    }
  }

  // --- disk.low ---
  if (input.diskFreeRatioMin <= 0) {
    results.push({ type: 'disk.low', alerted: false, reason: 'disabled' });
  } else {
    const disk = await readDiskStats(input.backupDir);
    if (!disk) {
      results.push({ type: 'disk.low', alerted: false, reason: 'unavailable' });
    } else if (
      !shouldAlertDiskLow({
        freeBytes: disk.freeBytes,
        totalBytes: disk.totalBytes,
        minFreeRatio: input.diskFreeRatioMin,
      })
    ) {
      results.push({ type: 'disk.low', alerted: false, reason: 'ok' });
    } else {
      const freePct = Math.floor((disk.freeBytes / disk.totalBytes) * 100);
      // Re-alert when free % drops into a new 5% bucket.
      const fingerprint = String(Math.floor(freePct / 5) * 5);
      if (already('disk.low', fingerprint)) {
        results.push({
          type: 'disk.low',
          alerted: false,
          reason: 'already_alerted',
        });
      } else {
        const outcome = await dispatchAlert({
          database: input.database,
          mailConfig: input.mailConfig,
          webhookUrl: input.webhookUrl,
          type: 'disk.low',
          webhookPayload: {
            type: 'disk.low',
            generatedAt: new Date().toISOString(),
            freeBytes: disk.freeBytes,
            totalBytes: disk.totalBytes,
            freeRatio: disk.freeBytes / disk.totalBytes,
            minFreeRatio: input.diskFreeRatioMin,
            monitoringUrl,
          },
          buildEmail: (locale, displayName) => {
            const loc = normalizeAppLocale(locale);
            const copy = getMailMessages(loc).opsAlertDiskLow;
            const freeLine = interpolate(copy.freeLabel, {
              free: formatBytes(disk.freeBytes),
              total: formatBytes(disk.totalBytes),
              percent: String(freePct),
            });
            return opsAlertEmail({
              locale,
              displayName,
              subject: copy.subject,
              title: copy.title,
              body: copy.body,
              detailLines: [freeLine],
              monitoringUrl,
            });
          },
        });
        if (outcome === 'no_admins') {
          results.push({
            type: 'disk.low',
            alerted: false,
            reason: 'no_admins',
          });
        } else {
          await mark('disk.low', fingerprint);
          results.push({ type: 'disk.low', alerted: true, reason: 'sent' });
        }
      }
    }
  }

  return results;
}

/** @deprecated Use runOpsAlerts — kept for a thin compatibility shim. */
export async function alertIfBackupStale(input: {
  database: Database;
  mailConfig: MailConfig;
  webUrl: string;
  backupDir: string;
  staleAfterHours: number;
  webhookUrl?: string;
}): Promise<{ alerted: boolean; reason: string }> {
  const results = await runOpsAlerts({
    ...input,
    errorSpikeThreshold: 0,
    errorSpikeWindowMinutes: 15,
    diskFreeRatioMin: 0,
  });
  const stale = results.find((row) => row.type === 'backup.stale');
  return {
    alerted: Boolean(stale?.alerted),
    reason: stale?.reason ?? 'unknown',
  };
}
