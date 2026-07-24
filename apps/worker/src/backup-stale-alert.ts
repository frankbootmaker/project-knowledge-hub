import { promises as fs } from 'node:fs';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { users, type Database } from '@project-knowledge-hub/database';
import {
  adminMonitoringUrl,
  backupStaleAlertEmail,
  createMailTransport,
  type MailConfig,
} from '@project-knowledge-hub/mail';

type AlertStamp = {
  at: string;
  lastSuccessAt: string | null;
  staleAfterHours: number;
};

function formatAge(ageSeconds: number | null): string {
  if (ageSeconds == null) return 'never (no last-success stamp)';
  const hours = Math.max(1, Math.floor(ageSeconds / 3600));
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

async function readLastSuccessAt(backupDir: string): Promise<{
  at: string | null;
  ageSeconds: number | null;
}> {
  try {
    const raw = await fs.readFile(path.join(backupDir, 'last-success.json'), 'utf8');
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

function isStale(ageSeconds: number | null, staleAfterHours: number): boolean {
  if (ageSeconds == null) return true;
  return ageSeconds > staleAfterHours * 3600;
}

async function readAlertStamp(backupDir: string): Promise<AlertStamp | null> {
  try {
    const raw = await fs.readFile(
      path.join(backupDir, 'last-stale-alert.json'),
      'utf8',
    );
    const parsed = JSON.parse(raw) as Partial<AlertStamp>;
    if (!parsed.at || typeof parsed.at !== 'string') return null;
    return {
      at: parsed.at,
      lastSuccessAt:
        typeof parsed.lastSuccessAt === 'string' ? parsed.lastSuccessAt : null,
      staleAfterHours:
        typeof parsed.staleAfterHours === 'number' ? parsed.staleAfterHours : 0,
    };
  } catch {
    return null;
  }
}

async function writeAlertStamp(backupDir: string, stamp: AlertStamp): Promise<void> {
  await fs.mkdir(backupDir, { recursive: true });
  await fs.writeFile(
    path.join(backupDir, 'last-stale-alert.json'),
    `${JSON.stringify(stamp, null, 2)}\n`,
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
      'User-Agent': 'project-knowledge-hub-backup-alert/1',
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`Alert webhook HTTP ${response.status}`);
  }
}

/**
 * NF-009 — email system admins (+ optional webhook) when backup is stale.
 * Dedupes until last-success advances (or first alert after never-backed-up).
 */
export async function alertIfBackupStale(input: {
  database: Database;
  mailConfig: MailConfig;
  webUrl: string;
  backupDir: string;
  staleAfterHours: number;
  webhookUrl?: string;
}): Promise<{ alerted: boolean; reason: string }> {
  const { at: lastSuccessAt, ageSeconds } = await readLastSuccessAt(input.backupDir);
  if (!isStale(ageSeconds, input.staleAfterHours)) {
    return { alerted: false, reason: 'fresh' };
  }

  const previous = await readAlertStamp(input.backupDir);
  if (
    previous &&
    previous.lastSuccessAt === lastSuccessAt &&
    previous.staleAfterHours === input.staleAfterHours
  ) {
    return { alerted: false, reason: 'already_alerted' };
  }

  const ageLabel = formatAge(ageSeconds);
  const monitoringUrl = adminMonitoringUrl(input.webUrl);
  const payload = {
    type: 'backup.stale' as const,
    generatedAt: new Date().toISOString(),
    lastSuccessAt,
    ageSeconds,
    ageLabel,
    staleAfterHours: input.staleAfterHours,
    monitoringUrl,
  };

  if (input.webhookUrl) {
    await postWebhook(input.webhookUrl, payload);
  }

  const admins = await input.database.db
    .select({
      displayName: users.displayName,
      email: users.email,
      preferredLocale: users.preferredLocale,
    })
    .from(users)
    .where(and(eq(users.isSystemAdmin, true), eq(users.status, 'active')));

  if (admins.length > 0) {
    const mail = createMailTransport(input.mailConfig);
    await Promise.all(
      admins.map(async (admin) => {
        const content = backupStaleAlertEmail({
          locale: admin.preferredLocale,
          displayName: admin.displayName,
          ageLabel,
          staleAfterHours: input.staleAfterHours,
          monitoringUrl,
        });
        await mail.send({
          to: admin.email,
          subject: content.subject,
          html: content.html,
          text: content.text,
        });
      }),
    );
  } else if (!input.webhookUrl) {
    return { alerted: false, reason: 'no_admins' };
  }

  await writeAlertStamp(input.backupDir, {
    at: new Date().toISOString(),
    lastSuccessAt,
    staleAfterHours: input.staleAfterHours,
  });

  return { alerted: true, reason: 'sent' };
}
