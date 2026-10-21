import { promises as fs } from 'node:fs';
import path from 'node:path';

export const OFFSITE_ERROR_FILE = 'last-offsite-error.json';
export const LOCAL_ROTATION_FILE = 'last-local-rotation.json';
export const S3_ROTATION_FILE = 'last-s3-rotation.json';

export type OffsiteErrorStamp = {
  kind: 'offsite_error';
  at: string;
  message: string;
  artifact: string;
};

export type RotationTarget = 'local' | 's3';

export type RotationStamp = {
  kind: 'local_rotation' | 's3_rotation';
  at: string;
  kept: number | null;
  deleted: number | null;
  error: string | null;
  dryRun: boolean;
};

const ROTATION_FILES: Record<RotationTarget, { file: string; kind: RotationStamp['kind'] }> = {
  local: { file: LOCAL_ROTATION_FILE, kind: 'local_rotation' },
  s3: { file: S3_ROTATION_FILE, kind: 's3_rotation' },
};

function stampNow(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function stampAgeSeconds(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return Math.max(0, Math.floor((Date.now() - ms) / 1000));
}

export async function readOffsiteErrorStamp(
  backupDir: string,
): Promise<OffsiteErrorStamp | null> {
  try {
    const raw = await fs.readFile(path.join(backupDir, OFFSITE_ERROR_FILE), 'utf8');
    const parsed = JSON.parse(raw) as Partial<OffsiteErrorStamp>;
    if (!parsed.at || typeof parsed.at !== 'string') return null;
    if (!parsed.message || typeof parsed.message !== 'string') return null;
    return {
      kind: 'offsite_error',
      at: parsed.at,
      message: parsed.message,
      artifact: typeof parsed.artifact === 'string' ? parsed.artifact : '',
    };
  } catch {
    return null;
  }
}

export async function writeOffsiteErrorStamp(
  backupDir: string,
  input: { message: string; artifact?: string; at?: string },
): Promise<OffsiteErrorStamp> {
  const stamp: OffsiteErrorStamp = {
    kind: 'offsite_error',
    at: input.at ?? stampNow(),
    message: input.message.slice(0, 500),
    artifact: input.artifact ?? '',
  };
  await fs.mkdir(backupDir, { recursive: true });
  await fs.writeFile(
    path.join(backupDir, OFFSITE_ERROR_FILE),
    `${JSON.stringify(stamp, null, 2)}\n`,
    'utf8',
  );
  return stamp;
}

export async function readRotationStamp(
  backupDir: string,
  target: RotationTarget,
): Promise<RotationStamp | null> {
  const { file, kind } = ROTATION_FILES[target];
  try {
    const raw = await fs.readFile(path.join(backupDir, file), 'utf8');
    const parsed = JSON.parse(raw) as Partial<RotationStamp>;
    if (!parsed.at || typeof parsed.at !== 'string') return null;
    return {
      kind,
      at: parsed.at,
      kept: finiteOrNull(parsed.kept),
      deleted: finiteOrNull(parsed.deleted),
      error: typeof parsed.error === 'string' ? parsed.error : null,
      dryRun: Boolean(parsed.dryRun),
    };
  } catch {
    return null;
  }
}

export async function writeRotationStamp(
  backupDir: string,
  target: RotationTarget,
  input: {
    kept: number | null;
    deleted: number | null;
    error?: string | null;
    dryRun?: boolean;
    at?: string;
  },
): Promise<RotationStamp> {
  const { file, kind } = ROTATION_FILES[target];
  const stamp: RotationStamp = {
    kind,
    at: input.at ?? stampNow(),
    kept: input.kept,
    deleted: input.deleted,
    error: input.error ? input.error.slice(0, 500) : null,
    dryRun: Boolean(input.dryRun),
  };
  await fs.mkdir(backupDir, { recursive: true });
  await fs.writeFile(
    path.join(backupDir, file),
    `${JSON.stringify(stamp, null, 2)}\n`,
    'utf8',
  );
  return stamp;
}

function finiteOrNull(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}
