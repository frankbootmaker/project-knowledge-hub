import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { AppEnv } from '@project-knowledge-hub/config';
import {
  OPS_ALERT_TYPES,
  configuredUserIds,
  listActiveAdminRecipients,
  listActiveUsersForAlerts,
  listRecipientUsers,
  loadEffectiveAlertSettings,
  readAuditRetentionSnapshot,
  recipientsFromSpec,
  type Database,
  type OpsAlertType,
  type StoredOpsAlertSettings,
  type WebhookMode,
} from '@project-knowledge-hub/database';
import { getPublicMailSettings } from './mail-settings.js';

type AlertStateEntry = { at?: string; fingerprint?: string };

export type OpsAlertAdminView = {
  source: 'override' | 'env';
  mail: {
    driver: 'console' | 'smtp' | 'resend';
    source: 'override' | 'env';
    consoleOnly: boolean;
  };
  thresholds: {
    diskFreeRatioMin: number;
    diskFreeGbMin: number;
    staleAfterHours: number;
    offsiteStaleAfterHours: number;
    errorSpikeThreshold: number;
    errorSpikeWindowMinutes: number;
    webhookMode: WebhookMode;
    webhookUrl: string;
    effectiveWebhookUrl: string | null;
  };
  env: {
    diskFreeRatioMin: number;
    diskFreeGbMin: number;
    staleAfterHours: number;
    offsiteStaleAfterHours: number;
    errorSpikeThreshold: number;
    errorSpikeWindowMinutes: number;
    webhookUrl: string;
    auditRetentionDays: number;
    auditRetentionIntervalMs: number;
  };
  recipients: Record<OpsAlertType, {
    configured: boolean;
    userIds: string[];
    emails: string[];
    source: 'admins' | 'custom';
    effective: Array<{ email: string; displayName: string }>;
    lastSentAt: string | null;
  }>;
  users: Array<{
    id: string;
    displayName: string;
    email: string;
    isSystemAdmin: boolean;
  }>;
  audit: {
    retentionDays: number;
    source: 'override' | 'env';
    intervalMs: number;
    lastPurgedAt: string | null;
    rowsPurged: number | null;
    rowCount: number;
    tableBytes: number;
  };
};

async function readAlertState(backupDir: string): Promise<Record<string, AlertStateEntry>> {
  try {
    const raw = await fs.readFile(path.join(backupDir, 'ops-alerts-state.json'), 'utf8');
    const parsed = JSON.parse(raw) as Record<string, AlertStateEntry>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function laterSent(a: AlertStateEntry | undefined, b: AlertStateEntry | undefined): string | null {
  const times = [a?.at, b?.at].filter((value): value is string => Boolean(value));
  if (times.length === 0) return null;
  return times.sort().at(-1) ?? null;
}

export async function getOpsAlertAdminView(
  database: Database,
  env: AppEnv,
  backupDir: string,
): Promise<OpsAlertAdminView> {
  const [{ stored, effective }, mail, admins, users, audit, state] = await Promise.all([
    loadEffectiveAlertSettings(database, env),
    getPublicMailSettings(database, env),
    listActiveAdminRecipients(database),
    listActiveUsersForAlerts(database),
    readAuditRetentionSnapshot(database),
    readAlertState(backupDir),
  ]);
  const selected = await listRecipientUsers(database, configuredUserIds(stored));
  const recipients = {} as OpsAlertAdminView['recipients'];
  for (const type of OPS_ALERT_TYPES) {
    const spec = stored?.recipients?.[type];
    const plan = recipientsFromSpec({ spec, admins, selectedUsers: selected });
    const lastSentAt = type === 'rotation.error'
      ? laterSent(state['rotation.local'], state['rotation.s3'])
      : (state[type]?.at ?? null);
    recipients[type] = {
      configured: spec?.configured === true,
      userIds: spec?.userIds ?? [],
      emails: spec?.emails ?? [],
      source: plan.source,
      effective: plan.recipients.map((row) => ({
        email: row.email,
        displayName: row.displayName,
      })),
      lastSentAt,
    };
  }

  return {
    source: effective.source,
    mail: {
      driver: mail.effectiveDriver,
      source: mail.source,
      consoleOnly: mail.effectiveDriver === 'console',
    },
    thresholds: {
      diskFreeRatioMin: effective.diskFreeRatioMin,
      diskFreeGbMin: effective.diskFreeGbMin,
      staleAfterHours: effective.staleAfterHours,
      offsiteStaleAfterHours: effective.offsiteStaleAfterHours,
      errorSpikeThreshold: effective.errorSpikeThreshold,
      errorSpikeWindowMinutes: effective.errorSpikeWindowMinutes,
      webhookMode: effective.webhookMode,
      webhookUrl: stored?.webhookUrl ?? '',
      effectiveWebhookUrl: effective.webhookUrl ?? null,
    },
    env: {
      diskFreeRatioMin: env.ALERT_DISK_FREE_RATIO_MIN,
      diskFreeGbMin: env.ALERT_DISK_FREE_GB_MIN,
      staleAfterHours: env.BACKUP_STALE_AFTER_HOURS,
      offsiteStaleAfterHours: env.BACKUP_OFFSITE_STALE_AFTER_HOURS,
      errorSpikeThreshold: env.ALERT_ERROR_SPIKE_THRESHOLD,
      errorSpikeWindowMinutes: env.ALERT_ERROR_SPIKE_WINDOW_MINUTES,
      webhookUrl: env.ALERT_WEBHOOK_URL ?? '',
      auditRetentionDays: env.AUDIT_RETENTION_DAYS,
      auditRetentionIntervalMs: env.AUDIT_RETENTION_INTERVAL_MS,
    },
    recipients,
    users: users.map((user) => ({
      id: user.id,
      displayName: user.displayName,
      email: user.email,
      isSystemAdmin: user.isSystemAdmin,
    })),
    audit: {
      retentionDays: effective.auditRetentionDays,
      source: effective.auditRetentionSource,
      intervalMs: effective.auditRetentionIntervalMs,
      lastPurgedAt: audit.lastPurgedAt,
      rowsPurged: audit.rowsPurged,
      rowCount: audit.rowCount,
      tableBytes: audit.tableBytes,
    },
  };
}

export function storedFromUpdate(input: {
  diskFreeRatioMin: number;
  diskFreeGbMin: number;
  staleAfterHours: number;
  offsiteStaleAfterHours: number;
  errorSpikeThreshold: number;
  errorSpikeWindowMinutes: number;
  webhookMode: WebhookMode;
  webhookUrl: string;
  auditRetentionDays: number;
  recipients: StoredOpsAlertSettings['recipients'];
}): StoredOpsAlertSettings {
  return {
    diskFreeRatioMin: input.diskFreeRatioMin,
    diskFreeGbMin: input.diskFreeGbMin,
    staleAfterHours: input.staleAfterHours,
    offsiteStaleAfterHours: input.offsiteStaleAfterHours,
    errorSpikeThreshold: input.errorSpikeThreshold,
    errorSpikeWindowMinutes: input.errorSpikeWindowMinutes,
    webhookMode: input.webhookMode,
    webhookUrl: input.webhookMode === 'custom' ? input.webhookUrl.trim() : '',
    auditRetentionDays: input.auditRetentionDays,
    recipients: input.recipients,
  };
}
