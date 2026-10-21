import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from './index.js';
import {
  auditRetentionState,
  platformSettings,
  users,
} from './schema/index.js';

/** platform_settings key. Absent row = env thresholds and all active admins. */
export const OPS_ALERT_SETTINGS_KEY = 'ops_alert_settings';

export const OPS_ALERT_TYPES = [
  'backup.stale',
  'backup.fail',
  'offsite.stale',
  'offsite.error',
  'rotation.error',
  'api.error_spike',
  'disk.low',
] as const;

export type OpsAlertType = (typeof OPS_ALERT_TYPES)[number];

export type WebhookMode = 'env' | 'custom' | 'disabled';

export type RecipientSpec = {
  /** False keeps the pre-T-116 behaviour: every active system admin. */
  configured: boolean;
  userIds: string[];
  emails: string[];
};

export type StoredOpsAlertSettings = {
  diskFreeRatioMin?: number;
  diskFreeGbMin?: number;
  staleAfterHours?: number;
  offsiteStaleAfterHours?: number;
  errorSpikeThreshold?: number;
  errorSpikeWindowMinutes?: number;
  webhookMode?: WebhookMode;
  webhookUrl?: string;
  auditRetentionDays?: number;
  recipients?: Partial<Record<OpsAlertType, RecipientSpec>>;
};

export type AlertEnvSource = {
  ALERT_DISK_FREE_RATIO_MIN: number;
  ALERT_DISK_FREE_GB_MIN: number;
  BACKUP_STALE_AFTER_HOURS: number;
  BACKUP_OFFSITE_STALE_AFTER_HOURS: number;
  ALERT_ERROR_SPIKE_THRESHOLD: number;
  ALERT_ERROR_SPIKE_WINDOW_MINUTES: number;
  ALERT_WEBHOOK_URL?: string;
  AUDIT_RETENTION_DAYS: number;
  AUDIT_RETENTION_INTERVAL_MS: number;
};

export type EffectiveAlertSettings = {
  source: 'override' | 'env';
  diskFreeRatioMin: number;
  diskFreeGbMin: number;
  staleAfterHours: number;
  offsiteStaleAfterHours: number;
  errorSpikeThreshold: number;
  errorSpikeWindowMinutes: number;
  webhookUrl?: string;
  webhookMode: WebhookMode;
  auditRetentionDays: number;
  auditRetentionIntervalMs: number;
  auditRetentionSource: 'override' | 'env';
};

export type AlertRecipient = {
  id?: string;
  email: string;
  displayName: string;
  preferredLocale: string | null;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function finiteInRange(
  value: unknown,
  min: number,
  max: number,
): number | undefined {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < min || n > max) return undefined;
  return n;
}

function intInRange(
  value: unknown,
  min: number,
  max: number,
): number | undefined {
  const n = finiteInRange(value, min, max);
  if (n == null) return undefined;
  return Math.trunc(n);
}

function cleanEmails(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const email = item.trim().toLowerCase();
    if (!EMAIL_RE.test(email) || email.length > 320 || seen.has(email)) continue;
    seen.add(email);
    out.push(email);
    if (out.length >= 20) break;
  }
  return out;
}

function cleanUserIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const id = item.trim();
    if (!/^[0-9a-f-]{36}$/i.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= 100) break;
  }
  return out;
}

function cleanRecipient(value: unknown): RecipientSpec | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const row = value as Partial<RecipientSpec>;
  return {
    configured: row.configured === true,
    userIds: cleanUserIds(row.userIds),
    emails: cleanEmails(row.emails),
  };
}

/** Drop unknown keys and out-of-range numbers so a bad row cannot crash the worker. */
export function parseStoredOpsAlertSettings(
  raw: string,
): StoredOpsAlertSettings | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const row = parsed as StoredOpsAlertSettings;
    const recipients: Partial<Record<OpsAlertType, RecipientSpec>> = {};
    for (const type of OPS_ALERT_TYPES) {
      const spec = cleanRecipient(row.recipients?.[type]);
      if (spec) recipients[type] = spec;
    }
    const webhookMode =
      row.webhookMode === 'custom' || row.webhookMode === 'disabled'
        ? row.webhookMode
        : row.webhookMode === 'env'
          ? 'env'
          : undefined;
    const webhookUrl =
      typeof row.webhookUrl === 'string' ? row.webhookUrl.trim() : undefined;
    return {
      diskFreeRatioMin: finiteInRange(row.diskFreeRatioMin, 0, 1),
      diskFreeGbMin: finiteInRange(row.diskFreeGbMin, 0, 100000),
      staleAfterHours: intInRange(row.staleAfterHours, 1, 168),
      offsiteStaleAfterHours: intInRange(row.offsiteStaleAfterHours, 1, 24 * 30),
      errorSpikeThreshold: intInRange(row.errorSpikeThreshold, 0, 1_000_000),
      errorSpikeWindowMinutes: intInRange(row.errorSpikeWindowMinutes, 1, 1440),
      webhookMode,
      webhookUrl: webhookUrl && webhookUrl.length <= 2000 ? webhookUrl : undefined,
      auditRetentionDays: intInRange(row.auditRetentionDays, 0, 3650),
      recipients,
    };
  } catch {
    return null;
  }
}

export function resolveEffectiveAlertSettings(
  stored: StoredOpsAlertSettings | null,
  env: AlertEnvSource,
): EffectiveAlertSettings {
  const pick = <T>(value: T | undefined, fallback: T): T =>
    value === undefined ? fallback : value;
  const webhookMode = stored?.webhookMode ?? 'env';
  let webhookUrl = env.ALERT_WEBHOOK_URL;
  if (webhookMode === 'disabled') webhookUrl = undefined;
  if (webhookMode === 'custom') {
    webhookUrl = stored?.webhookUrl?.trim() || undefined;
  }
  const auditFromDb = stored?.auditRetentionDays;
  return {
    source: stored ? 'override' : 'env',
    diskFreeRatioMin: pick(stored?.diskFreeRatioMin, env.ALERT_DISK_FREE_RATIO_MIN),
    diskFreeGbMin: pick(stored?.diskFreeGbMin, env.ALERT_DISK_FREE_GB_MIN),
    staleAfterHours: pick(stored?.staleAfterHours, env.BACKUP_STALE_AFTER_HOURS),
    offsiteStaleAfterHours: pick(
      stored?.offsiteStaleAfterHours,
      env.BACKUP_OFFSITE_STALE_AFTER_HOURS,
    ),
    errorSpikeThreshold: pick(
      stored?.errorSpikeThreshold,
      env.ALERT_ERROR_SPIKE_THRESHOLD,
    ),
    errorSpikeWindowMinutes: pick(
      stored?.errorSpikeWindowMinutes,
      env.ALERT_ERROR_SPIKE_WINDOW_MINUTES,
    ),
    webhookUrl,
    webhookMode,
    auditRetentionDays: pick(auditFromDb, env.AUDIT_RETENTION_DAYS),
    auditRetentionIntervalMs: env.AUDIT_RETENTION_INTERVAL_MS,
    auditRetentionSource: auditFromDb === undefined ? 'env' : 'override',
  };
}

export async function readStoredOpsAlertSettings(
  database: Database,
): Promise<StoredOpsAlertSettings | null> {
  const [row] = await database.db
    .select()
    .from(platformSettings)
    .where(eq(platformSettings.key, OPS_ALERT_SETTINGS_KEY))
    .limit(1);
  if (!row?.value?.trim()) return null;
  return parseStoredOpsAlertSettings(row.value);
}

export async function loadEffectiveAlertSettings(
  database: Database,
  env: AlertEnvSource,
): Promise<{
  stored: StoredOpsAlertSettings | null;
  effective: EffectiveAlertSettings;
}> {
  const stored = await readStoredOpsAlertSettings(database);
  return { stored, effective: resolveEffectiveAlertSettings(stored, env) };
}

export async function saveStoredOpsAlertSettings(
  database: Database,
  value: StoredOpsAlertSettings,
  updatedBy: string | null,
): Promise<void> {
  const payload = JSON.stringify(value);
  await database.db
    .insert(platformSettings)
    .values({
      key: OPS_ALERT_SETTINGS_KEY,
      value: payload,
      updatedBy,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: platformSettings.key,
      set: {
        value: payload,
        updatedBy,
        updatedAt: new Date(),
      },
    });
}

export async function clearStoredOpsAlertSettings(
  database: Database,
): Promise<void> {
  await database.db
    .delete(platformSettings)
    .where(eq(platformSettings.key, OPS_ALERT_SETTINGS_KEY));
}

export function configuredUserIds(stored: StoredOpsAlertSettings | null): string[] {
  if (!stored?.recipients) return [];
  const ids = new Set<string>();
  for (const type of OPS_ALERT_TYPES) {
    const spec = stored.recipients[type];
    if (!spec?.configured) continue;
    for (const id of spec.userIds) ids.add(id);
  }
  return [...ids];
}

export function dedupeRecipients(rows: AlertRecipient[]): AlertRecipient[] {
  const seen = new Set<string>();
  const out: AlertRecipient[] = [];
  for (const row of rows) {
    const email = row.email.trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    out.push({ ...row, email });
  }
  return out;
}

/**
 * Unconfigured (or configured: false) falls back to every active system admin.
 * A configured list, including an empty one, is used as-is.
 */
export function recipientsFromSpec(input: {
  spec: RecipientSpec | undefined;
  admins: AlertRecipient[];
  selectedUsers: AlertRecipient[];
}): { recipients: AlertRecipient[]; source: 'admins' | 'custom' } {
  if (!input.spec?.configured) {
    return { recipients: dedupeRecipients(input.admins), source: 'admins' };
  }
  const wanted = new Set(input.spec.userIds);
  const selected = input.selectedUsers.filter(
    (user) => user.id && wanted.has(user.id),
  );
  const extras: AlertRecipient[] = input.spec.emails.map((email) => ({
    email,
    displayName: email,
    preferredLocale: null,
  }));
  return {
    recipients: dedupeRecipients([...selected, ...extras]),
    source: 'custom',
  };
}

const recipientColumns = {
  id: users.id,
  email: users.email,
  displayName: users.displayName,
  preferredLocale: users.preferredLocale,
  isSystemAdmin: users.isSystemAdmin,
};

export type AlertUserOption = {
  id: string;
  email: string;
  displayName: string;
  preferredLocale: string | null;
  isSystemAdmin: boolean;
};

export async function listActiveAdminRecipients(
  database: Database,
): Promise<AlertRecipient[]> {
  const rows = await database.db
    .select(recipientColumns)
    .from(users)
    .where(and(eq(users.isSystemAdmin, true), eq(users.status, 'active')))
    .orderBy(asc(users.displayName));
  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    preferredLocale: row.preferredLocale,
  }));
}

export async function listRecipientUsers(
  database: Database,
  ids: string[],
): Promise<AlertRecipient[]> {
  if (ids.length === 0) return [];
  const rows = await database.db
    .select(recipientColumns)
    .from(users)
    .where(and(inArray(users.id, ids), eq(users.status, 'active')));
  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    preferredLocale: row.preferredLocale,
  }));
}

export async function listActiveUsersForAlerts(
  database: Database,
): Promise<AlertUserOption[]> {
  return database.db
    .select(recipientColumns)
    .from(users)
    .where(eq(users.status, 'active'))
    .orderBy(asc(users.displayName))
    .limit(500);
}

export async function recordAuditRetentionRun(
  database: Database,
  input: {
    lastPurgedAt: Date;
    rowsPurged: number;
    retentionDays: number;
    cutoff: Date | null;
  },
): Promise<void> {
  await database.db
    .insert(auditRetentionState)
    .values({
      id: 'default',
      lastPurgedAt: input.lastPurgedAt,
      rowsPurged: input.rowsPurged,
      retentionDays: input.retentionDays,
      cutoff: input.cutoff,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: auditRetentionState.id,
      set: {
        lastPurgedAt: input.lastPurgedAt,
        rowsPurged: input.rowsPurged,
        retentionDays: input.retentionDays,
        cutoff: input.cutoff,
        updatedAt: new Date(),
      },
    });
}

export type AuditRetentionSnapshot = {
  lastPurgedAt: string | null;
  rowsPurged: number | null;
  retentionDaysApplied: number | null;
  rowCount: number;
  tableBytes: number;
};

function rowsFromExecute<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (
    result &&
    typeof result === 'object' &&
    Array.isArray((result as { rows?: unknown }).rows)
  ) {
    return (result as { rows: T[] }).rows;
  }
  return [];
}

export async function readAuditRetentionSnapshot(
  database: Database,
): Promise<AuditRetentionSnapshot> {
  const [state] = await database.db
    .select()
    .from(auditRetentionState)
    .where(eq(auditRetentionState.id, 'default'))
    .limit(1);
  const sizeRows = rowsFromExecute<{ rowCount: number | string; tableBytes: number | string }>(
    await database.db.execute(sql`
      SELECT
        (SELECT count(*)::int FROM audit_events) AS "rowCount",
        pg_total_relation_size('public.audit_events')::bigint AS "tableBytes"
    `),
  );
  const size = sizeRows[0];
  return {
    lastPurgedAt: state?.lastPurgedAt ? state.lastPurgedAt.toISOString() : null,
    rowsPurged: state ? state.rowsPurged : null,
    retentionDaysApplied: state?.retentionDays ?? null,
    rowCount: Number(size?.rowCount ?? 0),
    tableBytes: Number(size?.tableBytes ?? 0),
  };
}
