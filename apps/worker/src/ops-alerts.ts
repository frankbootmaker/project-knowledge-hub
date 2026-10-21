import { promises as fs } from 'node:fs';
import path from 'node:path';
import { and, count, eq, gte, sql } from 'drizzle-orm';
import {
  readOffsiteErrorStamp,
  readRotationStamp,
} from '@project-knowledge-hub/blob-store';
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
  | 'offsite.stale'
  | 'offsite.error'
  | 'rotation.error'
  | 'api.error_spike'
  | 'disk.low';

/** 1 GB = 1024^3 bytes, matching `df -h`. */
export const BYTES_PER_GB = 1024 ** 3;

type AlertStateKey = OpsAlertType | 'rotation.local' | 'rotation.s3';

type AlertStateEntry = {
  at: string;
  fingerprint: string;
};

type AlertState = Partial<Record<AlertStateKey, AlertStateEntry>>;

const STATE_FILE = 'ops-alerts-state.json';
/** Legacy stamp from the first NF-009 slice — still honored for backup.stale. */
const LEGACY_STALE_FILE = 'last-stale-alert.json';

export type OpsAlertRecipient = {
  email: string;
  displayName: string;
  preferredLocale: string | null;
};

export type OpsAlertMail = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

function formatAge(ageSeconds: number | null): string {
  if (ageSeconds == null) return 'never (no stamp)';
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

export function isOffsiteBackupStale(
  ageSeconds: number | null,
  staleAfterHours: number,
  offsiteEnabled: boolean,
): boolean {
  if (!offsiteEnabled) return false;
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

export function shouldAlertOffsiteError(input: {
  errorAt: string | null;
  successAt: string | null;
}): boolean {
  if (!input.errorAt) return false;
  if (!input.successAt) return true;
  return new Date(input.errorAt).getTime() > new Date(input.successAt).getTime();
}

export function shouldAlertRotationError(input: {
  error: string | null;
  dryRun: boolean;
} | null): boolean {
  if (!input || input.dryRun) return false;
  return Boolean(input.error && input.error.trim());
}

/**
 * True when free space is under the ratio or under the absolute byte minimum.
 * Either threshold of 0 disables that check. Both 0 disables the alert.
 */
export function shouldAlertDiskLow(input: {
  freeBytes: number;
  totalBytes: number;
  minFreeRatio: number;
  minFreeBytes?: number;
}): boolean {
  const minFreeBytes = input.minFreeBytes ?? 0;
  if (minFreeBytes <= 0 && input.minFreeRatio <= 0) return false;
  const ratioLow =
    input.minFreeRatio > 0 &&
    input.totalBytes > 0 &&
    input.freeBytes / input.totalBytes < input.minFreeRatio;
  const absoluteLow = minFreeBytes > 0 && input.freeBytes < minFreeBytes;
  return ratioLow || absoluteLow;
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

export async function readOpsAlertState(backupDir: string): Promise<AlertState> {
  try {
    const raw = await fs.readFile(path.join(backupDir, STATE_FILE), 'utf8');
    const parsed = JSON.parse(raw) as AlertState;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
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

async function listActiveAdmins(database: Database): Promise<OpsAlertRecipient[]> {
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
  mailConfig: MailConfig;
  webhookUrl?: string;
  recipients: OpsAlertRecipient[];
  webhookPayload: Record<string, unknown>;
  buildEmail: (locale: string | null, displayName: string) => {
    subject: string;
    html: string;
    text: string;
  };
  sendMail?: (message: OpsAlertMail) => Promise<void>;
  postWebhook?: (url: string, payload: Record<string, unknown>) => Promise<void>;
}): Promise<'sent' | 'no_recipients'> {
  if (input.webhookUrl) {
    const post = input.postWebhook ?? postWebhook;
    await post(input.webhookUrl, input.webhookPayload);
  }

  if (input.recipients.length === 0) {
    return input.webhookUrl ? 'sent' : 'no_recipients';
  }

  const send = input.sendMail
    ?? (async (message: OpsAlertMail) => {
      const mail = createMailTransport(input.mailConfig);
      await mail.send(message);
    });

  await Promise.all(
    input.recipients.map(async (recipient) => {
      const content = input.buildEmail(
        recipient.preferredLocale,
        recipient.displayName,
      );
      await send({
        to: recipient.email,
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

export async function runOpsAlerts(input: {
  database: Database;
  mailConfig: MailConfig;
  webUrl: string;
  backupDir: string;
  staleAfterHours: number;
  offsiteStaleAfterHours?: number;
  offsiteEnabled?: boolean;
  webhookUrl?: string;
  errorSpikeThreshold: number;
  errorSpikeWindowMinutes: number;
  diskFreeRatioMin: number;
  diskFreeGbMin?: number;
  resolveRecipients: (type: OpsAlertType) => Promise<OpsAlertRecipient[]>;
  diskStats?: { freeBytes: number; totalBytes: number } | null;
  sendMail?: (message: OpsAlertMail) => Promise<void>;
  postWebhook?: (url: string, payload: Record<string, unknown>) => Promise<void>;
}): Promise<OpsAlertRunResult[]> {
  const monitoringUrl = adminMonitoringUrl(input.webUrl);
  const state = await readOpsAlertState(input.backupDir);
  const results: OpsAlertRunResult[] = [];
  const offsiteStaleAfterHours = input.offsiteStaleAfterHours ?? 48;
  const offsiteEnabled = input.offsiteEnabled ?? false;
  const diskFreeGbMin = input.diskFreeGbMin ?? 0;

  const mark = async (key: AlertStateKey, fingerprint: string) => {
    state[key] = { at: new Date().toISOString(), fingerprint };
    await writeAlertState(input.backupDir, state);
  };

  const already = (key: AlertStateKey, fingerprint: string) =>
    state[key]?.fingerprint === fingerprint;

  const deliver = async (
    type: OpsAlertType,
    stateKey: AlertStateKey,
    fingerprint: string,
    webhookPayload: Record<string, unknown>,
    buildEmail: (locale: string | null, displayName: string) => {
      subject: string;
      html: string;
      text: string;
    },
  ): Promise<OpsAlertRunResult> => {
    const recipients = await input.resolveRecipients(type);
    const outcome = await dispatchAlert({
      mailConfig: input.mailConfig,
      webhookUrl: input.webhookUrl,
      recipients,
      webhookPayload,
      buildEmail,
      sendMail: input.sendMail,
      postWebhook: input.postWebhook,
    });
    if (outcome === 'no_recipients') {
      return { type, alerted: false, reason: 'no_recipients' };
    }
    await mark(stateKey, fingerprint);
    return { type, alerted: true, reason: 'sent' };
  };

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
        results.push({ type: 'backup.stale', alerted: false, reason: 'already_alerted' });
      } else {
        const ageLabel = formatAge(ageSeconds);
        results.push(await deliver(
          'backup.stale',
          'backup.stale',
          fingerprint,
          {
            type: 'backup.stale',
            generatedAt: new Date().toISOString(),
            lastSuccessAt,
            ageSeconds,
            ageLabel,
            staleAfterHours: input.staleAfterHours,
            monitoringUrl,
          },
          (locale, displayName) => backupStaleAlertEmail({
            locale,
            displayName,
            ageLabel,
            staleAfterHours: input.staleAfterHours,
            monitoringUrl,
          }),
        ));
      }
    }
  }

  // --- backup.fail ---
  {
    const { at: lastSuccessAt } = await readStampAt(input.backupDir, 'last-success.json');
    const { at: lastFailureAt } = await readStampAt(input.backupDir, 'last-failure.json');
    if (!shouldAlertBackupFail({ lastSuccessAt, lastFailureAt })) {
      results.push({ type: 'backup.fail', alerted: false, reason: 'ok' });
    } else {
      const fingerprint = lastFailureAt ?? 'unknown';
      if (already('backup.fail', fingerprint)) {
        results.push({ type: 'backup.fail', alerted: false, reason: 'already_alerted' });
      } else {
        results.push(await deliver(
          'backup.fail',
          'backup.fail',
          fingerprint,
          {
            type: 'backup.fail',
            generatedAt: new Date().toISOString(),
            lastSuccessAt,
            lastFailureAt,
            monitoringUrl,
          },
          (locale, displayName) => {
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
        ));
      }
    }
  }

  // --- offsite.stale ---
  {
    if (!offsiteEnabled) {
      results.push({ type: 'offsite.stale', alerted: false, reason: 'disabled' });
    } else {
      const { at: lastOffsiteAt, ageSeconds } = await readStampAt(
        input.backupDir,
        'last-offsite.json',
      );
      if (!isOffsiteBackupStale(ageSeconds, offsiteStaleAfterHours, true)) {
        results.push({ type: 'offsite.stale', alerted: false, reason: 'fresh' });
      } else {
        const fingerprint = `${lastOffsiteAt ?? 'null'}|${offsiteStaleAfterHours}`;
        if (already('offsite.stale', fingerprint)) {
          results.push({ type: 'offsite.stale', alerted: false, reason: 'already_alerted' });
        } else {
          const ageLabel = formatAge(ageSeconds);
          results.push(await deliver(
            'offsite.stale',
            'offsite.stale',
            fingerprint,
            {
              type: 'offsite.stale',
              generatedAt: new Date().toISOString(),
              lastOffsiteAt,
              ageSeconds,
              ageLabel,
              staleAfterHours: offsiteStaleAfterHours,
              monitoringUrl,
            },
            (locale, displayName) => {
              const loc = normalizeAppLocale(locale);
              const copy = getMailMessages(loc).opsAlertOffsiteStale;
              return opsAlertEmail({
                locale,
                displayName,
                subject: copy.subject,
                title: copy.title,
                body: copy.body,
                detailLines: [
                  interpolate(copy.ageLabel, { age: ageLabel }),
                  interpolate(copy.thresholdLabel, {
                    hours: String(offsiteStaleAfterHours),
                  }),
                ],
                monitoringUrl,
              });
            },
          ));
        }
      }
    }
  }

  // --- offsite.error ---
  {
    const { at: lastOffsiteAt } = await readStampAt(input.backupDir, 'last-offsite.json');
    const errorStamp = await readOffsiteErrorStamp(input.backupDir);
    if (!shouldAlertOffsiteError({
      errorAt: errorStamp?.at ?? null,
      successAt: lastOffsiteAt,
    })) {
      results.push({ type: 'offsite.error', alerted: false, reason: 'ok' });
    } else {
      const fingerprint = `${errorStamp?.at ?? 'unknown'}|${errorStamp?.message ?? ''}`;
      if (already('offsite.error', fingerprint)) {
        results.push({ type: 'offsite.error', alerted: false, reason: 'already_alerted' });
      } else {
        const message = (errorStamp?.message ?? 'unknown').slice(0, 300);
        results.push(await deliver(
          'offsite.error',
          'offsite.error',
          fingerprint,
          {
            type: 'offsite.error',
            generatedAt: new Date().toISOString(),
            at: errorStamp?.at ?? null,
            message,
            monitoringUrl,
          },
          (locale, displayName) => {
            const loc = normalizeAppLocale(locale);
            const copy = getMailMessages(loc).opsAlertOffsiteError;
            return opsAlertEmail({
              locale,
              displayName,
              subject: copy.subject,
              title: copy.title,
              body: copy.body,
              detailLines: [
                interpolate(copy.errorLabel, { message }),
                interpolate(copy.atLabel, { at: errorStamp?.at ?? 'unknown' }),
              ],
              monitoringUrl,
            });
          },
        ));
      }
    }
  }

  // --- rotation.error (local and S3, deduped separately) ---
  for (const target of ['local', 's3'] as const) {
    const stamp = await readRotationStamp(input.backupDir, target);
    const stateKey: AlertStateKey = target === 'local' ? 'rotation.local' : 'rotation.s3';
    if (!shouldAlertRotationError(stamp)) {
      results.push({ type: 'rotation.error', alerted: false, reason: `${target}:ok` });
      continue;
    }
    const fingerprint = `${stamp?.at ?? 'unknown'}|${stamp?.error ?? ''}`;
    if (already(stateKey, fingerprint)) {
      results.push({
        type: 'rotation.error',
        alerted: false,
        reason: `${target}:already_alerted`,
      });
      continue;
    }
    const message = (stamp?.error ?? 'unknown').slice(0, 300);
    const targetLabel = target === 's3' ? 'S3' : 'local';
    results.push(await deliver(
      'rotation.error',
      stateKey,
      fingerprint,
      {
        type: 'rotation.error',
        target,
        generatedAt: new Date().toISOString(),
        at: stamp?.at ?? null,
        message,
        monitoringUrl,
      },
      (locale, displayName) => {
        const loc = normalizeAppLocale(locale);
        const copy = getMailMessages(loc).opsAlertRotationError;
        return opsAlertEmail({
          locale,
          displayName,
          subject: copy.subject,
          title: copy.title,
          body: copy.body,
          detailLines: [
            interpolate(copy.targetLabel, { target: targetLabel }),
            interpolate(copy.errorLabel, { message }),
          ],
          monitoringUrl,
        });
      },
    ));
  }

  // --- api.error_spike ---
  if (input.errorSpikeThreshold <= 0) {
    results.push({ type: 'api.error_spike', alerted: false, reason: 'disabled' });
  } else {
    const windowMs = input.errorSpikeWindowMinutes * 60 * 1000;
    const since = new Date(Date.now() - windowMs);
    const errorCount = await countErrorLikeAudits(input.database, since);
    if (errorCount < input.errorSpikeThreshold) {
      results.push({ type: 'api.error_spike', alerted: false, reason: 'below_threshold' });
    } else {
      const bucket = Math.floor(Date.now() / windowMs);
      const fingerprint = `${bucket}|${input.errorSpikeThreshold}`;
      if (already('api.error_spike', fingerprint)) {
        results.push({ type: 'api.error_spike', alerted: false, reason: 'already_alerted' });
      } else {
        results.push(await deliver(
          'api.error_spike',
          'api.error_spike',
          fingerprint,
          {
            type: 'api.error_spike',
            generatedAt: new Date().toISOString(),
            errorCount,
            threshold: input.errorSpikeThreshold,
            windowMinutes: input.errorSpikeWindowMinutes,
            monitoringUrl,
          },
          (locale, displayName) => {
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
        ));
      }
    }
  }

  // --- disk.low ---
  if (input.diskFreeRatioMin <= 0 && diskFreeGbMin <= 0) {
    results.push({ type: 'disk.low', alerted: false, reason: 'disabled' });
  } else {
    const disk = 'diskStats' in input
      ? input.diskStats ?? null
      : await readDiskStats(input.backupDir);
    const minFreeBytes = diskFreeGbMin > 0 ? diskFreeGbMin * BYTES_PER_GB : 0;
    if (!disk) {
      results.push({ type: 'disk.low', alerted: false, reason: 'unavailable' });
    } else if (!shouldAlertDiskLow({
      freeBytes: disk.freeBytes,
      totalBytes: disk.totalBytes,
      minFreeRatio: input.diskFreeRatioMin,
      minFreeBytes,
    })) {
      results.push({ type: 'disk.low', alerted: false, reason: 'ok' });
    } else {
      const freePct = disk.totalBytes > 0
        ? Math.floor((disk.freeBytes / disk.totalBytes) * 100)
        : 0;
      const gbBucket = Math.floor(disk.freeBytes / BYTES_PER_GB);
      const ratioBucket = Math.floor(freePct / 5) * 5;
      const fingerprint = `${ratioBucket}|${gbBucket}`;
      if (already('disk.low', fingerprint)) {
        results.push({ type: 'disk.low', alerted: false, reason: 'already_alerted' });
      } else {
        results.push(await deliver(
          'disk.low',
          'disk.low',
          fingerprint,
          {
            type: 'disk.low',
            generatedAt: new Date().toISOString(),
            freeBytes: disk.freeBytes,
            totalBytes: disk.totalBytes,
            freeRatio: disk.totalBytes > 0 ? disk.freeBytes / disk.totalBytes : null,
            minFreeRatio: input.diskFreeRatioMin,
            minFreeGb: diskFreeGbMin,
            monitoringUrl,
          },
          (locale, displayName) => {
            const loc = normalizeAppLocale(locale);
            const copy = getMailMessages(loc).opsAlertDiskLow;
            const lines = [
              interpolate(copy.freeLabel, {
                free: formatBytes(disk.freeBytes),
                total: formatBytes(disk.totalBytes),
                percent: String(freePct),
              }),
            ];
            if (diskFreeGbMin > 0) {
              lines.push(interpolate(copy.absoluteLabel, { gb: String(diskFreeGbMin) }));
            }
            if (input.diskFreeRatioMin > 0) {
              lines.push(interpolate(copy.ratioLabel, {
                percent: String(Math.round(input.diskFreeRatioMin * 100)),
              }));
            }
            return opsAlertEmail({
              locale,
              displayName,
              subject: copy.subject,
              title: copy.title,
              body: copy.body,
              detailLines: lines,
              monitoringUrl,
            });
          },
        ));
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
  const admins = await listActiveAdmins(input.database);
  const results = await runOpsAlerts({
    ...input,
    errorSpikeThreshold: 0,
    errorSpikeWindowMinutes: 15,
    diskFreeRatioMin: 0,
    diskFreeGbMin: 0,
    offsiteEnabled: false,
    resolveRecipients: async () => admins,
  });
  const stale = results.find((row) => row.type === 'backup.stale');
  return {
    alerted: Boolean(stale?.alerted),
    reason: stale?.reason ?? 'unknown',
  };
}
