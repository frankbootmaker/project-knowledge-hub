import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { AppEnv } from '@project-knowledge-hub/config';

export const SCHEDULE_FILE = 'schedule.json';

/** Admin UI presets (seconds). */
export const SCHEDULE_INTERVAL_PRESETS = [
  3600, // 1h
  21600, // 6h
  43200, // 12h
  86400, // 24h
  604800, // 7d
] as const;

export type ScheduleIntervalPreset = (typeof SCHEDULE_INTERVAL_PRESETS)[number];

export type BackupSchedulePolicy = {
  enabled: boolean;
  /** Seconds between dumps (≥ 60). */
  intervalSeconds: number;
};

export function envScheduleDefaults(env: AppEnv): BackupSchedulePolicy {
  return {
    enabled: env.BACKUP_ENABLED,
    intervalSeconds: env.BACKUP_INTERVAL_SECONDS,
  };
}

export function isScheduleIntervalPreset(
  value: number,
): value is ScheduleIntervalPreset {
  return (SCHEDULE_INTERVAL_PRESETS as readonly number[]).includes(value);
}

export async function readSchedulePolicy(
  backupDir: string,
  envDefaults: BackupSchedulePolicy,
): Promise<{ policy: BackupSchedulePolicy; source: 'file' | 'env' }> {
  const filePath = path.join(backupDir, SCHEDULE_FILE);
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<BackupSchedulePolicy>;
    return {
      source: 'file',
      policy: {
        enabled:
          typeof parsed.enabled === 'boolean'
            ? parsed.enabled
            : envDefaults.enabled,
        intervalSeconds: clampIntervalSeconds(
          parsed.intervalSeconds,
          envDefaults.intervalSeconds,
        ),
      },
    };
  } catch {
    return { source: 'env', policy: { ...envDefaults } };
  }
}

export async function writeSchedulePolicy(
  backupDir: string,
  policy: BackupSchedulePolicy,
): Promise<BackupSchedulePolicy> {
  await fs.mkdir(backupDir, { recursive: true });
  const intervalSeconds = isScheduleIntervalPreset(policy.intervalSeconds)
    ? policy.intervalSeconds
    : nearestPreset(policy.intervalSeconds);
  const normalized: BackupSchedulePolicy = {
    enabled: Boolean(policy.enabled),
    intervalSeconds,
  };
  await fs.writeFile(
    path.join(backupDir, SCHEDULE_FILE),
    `${JSON.stringify(normalized, null, 2)}\n`,
    'utf8',
  );
  return normalized;
}

function clampIntervalSeconds(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return Math.max(60, Math.trunc(fallback));
  return Math.max(60, Math.trunc(n));
}

function nearestPreset(seconds: number): ScheduleIntervalPreset {
  const clamped = Math.max(60, Math.trunc(seconds));
  let best: ScheduleIntervalPreset = SCHEDULE_INTERVAL_PRESETS[3]; // 24h
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const preset of SCHEDULE_INTERVAL_PRESETS) {
    const delta = Math.abs(preset - clamped);
    if (delta < bestDelta) {
      best = preset;
      bestDelta = delta;
    }
  }
  return best;
}
