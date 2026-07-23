import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { AppEnv } from '@project-knowledge-hub/config';

export const RETENTION_FILE = 'retention.json';

export type BackupRetentionPolicy = {
  keepDaily: number;
  keepWeekly: number;
  keepMonthly: number;
  /** When true, run rotation after scheduled/API export. */
  autoRotate: boolean;
};

export function envRetentionDefaults(env: AppEnv): BackupRetentionPolicy {
  return {
    keepDaily: env.BACKUP_KEEP_DAILY,
    keepWeekly: env.BACKUP_KEEP_WEEKLY,
    keepMonthly: env.BACKUP_KEEP_MONTHLY,
    autoRotate: env.BACKUP_AUTO_ROTATE,
  };
}

export async function readRetentionPolicy(
  backupDir: string,
  envDefaults: BackupRetentionPolicy,
): Promise<{ policy: BackupRetentionPolicy; source: 'file' | 'env' }> {
  const filePath = path.join(backupDir, RETENTION_FILE);
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<BackupRetentionPolicy>;
    return {
      source: 'file',
      policy: {
        keepDaily: clampInt(parsed.keepDaily, 1, 90, envDefaults.keepDaily),
        keepWeekly: clampInt(parsed.keepWeekly, 0, 52, envDefaults.keepWeekly),
        keepMonthly: clampInt(parsed.keepMonthly, 0, 36, envDefaults.keepMonthly),
        autoRotate:
          typeof parsed.autoRotate === 'boolean'
            ? parsed.autoRotate
            : envDefaults.autoRotate,
      },
    };
  } catch {
    return { source: 'env', policy: { ...envDefaults } };
  }
}

export async function writeRetentionPolicy(
  backupDir: string,
  policy: BackupRetentionPolicy,
): Promise<BackupRetentionPolicy> {
  await fs.mkdir(backupDir, { recursive: true });
  const normalized: BackupRetentionPolicy = {
    keepDaily: clampInt(policy.keepDaily, 1, 90, 7),
    keepWeekly: clampInt(policy.keepWeekly, 0, 52, 4),
    keepMonthly: clampInt(policy.keepMonthly, 0, 36, 3),
    autoRotate: Boolean(policy.autoRotate),
  };
  await fs.writeFile(
    path.join(backupDir, RETENTION_FILE),
    `${JSON.stringify(normalized, null, 2)}\n`,
    'utf8',
  );
  return normalized;
}

function clampInt(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}
