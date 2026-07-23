import { createWriteStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { AppError } from '@project-knowledge-hub/domain';

export type BackupStamp = {
  kind: string;
  at: string;
  artifact: string;
  schemaVersion: string;
  hostname: string;
};

export type BackupArtifact = {
  name: string;
  sizeBytes: number;
  modifiedAt: string;
};

const DUMP_NAME_RE = /^knowledge-hub-[A-Za-z0-9._-]+\.dump$/;

export function assertSafeDumpName(name: string): string {
  const base = path.basename(name);
  if (base !== name || !DUMP_NAME_RE.test(base)) {
    throw new AppError({
      code: 'BACKUP_INVALID_NAME',
      message: 'Dump name must look like knowledge-hub-….dump',
      statusCode: 400,
    });
  }
  return base;
}

export async function ensureBackupDir(backupDir: string): Promise<void> {
  await fs.mkdir(backupDir, { recursive: true });
}

export async function readStamp(
  backupDir: string,
  fileName: 'last-success.json' | 'last-import.json',
): Promise<BackupStamp | null> {
  const stampPath = path.join(backupDir, fileName);
  try {
    const raw = await fs.readFile(stampPath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<BackupStamp>;
    if (!parsed.at || typeof parsed.at !== 'string') return null;
    return {
      kind: typeof parsed.kind === 'string' ? parsed.kind : fileName,
      at: parsed.at,
      artifact: typeof parsed.artifact === 'string' ? parsed.artifact : '',
      schemaVersion:
        typeof parsed.schemaVersion === 'string' ? parsed.schemaVersion : 'unknown',
      hostname: typeof parsed.hostname === 'string' ? parsed.hostname : 'unknown',
    };
  } catch {
    return null;
  }
}

export async function writeStamp(
  backupDir: string,
  fileName: 'last-success.json' | 'last-import.json',
  stamp: BackupStamp,
): Promise<void> {
  await ensureBackupDir(backupDir);
  await fs.writeFile(
    path.join(backupDir, fileName),
    `${JSON.stringify(stamp, null, 2)}\n`,
    'utf8',
  );
}

export async function listDumpArtifacts(
  backupDir: string,
  limit = 40,
): Promise<BackupArtifact[]> {
  await ensureBackupDir(backupDir);
  let entries: string[];
  try {
    entries = await fs.readdir(backupDir);
  } catch {
    return [];
  }

  const artifacts: BackupArtifact[] = [];
  for (const name of entries) {
    if (!DUMP_NAME_RE.test(name)) continue;
    const full = path.join(backupDir, name);
    try {
      const stat = await fs.stat(full);
      if (!stat.isFile()) continue;
      artifacts.push({
        name,
        sizeBytes: stat.size,
        modifiedAt: stat.mtime.toISOString(),
      });
    } catch {
      // skip
    }
  }

  artifacts.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  return artifacts.slice(0, limit);
}

function ageSeconds(iso: string | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return Math.max(0, Math.floor((Date.now() - ms) / 1000));
}

export function stampSummary(stamp: BackupStamp | null) {
  if (!stamp) {
    return { stamp: null, ageSeconds: null as number | null };
  }
  return { stamp, ageSeconds: ageSeconds(stamp.at) };
}

async function runCommand(
  command: string,
  args: string[],
  options: { env?: NodeJS.ProcessEnv; stdin?: Buffer | null } = {},
): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...options.env },
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    const stderrChunks: Buffer[] = [];
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));
    child.on('error', reject);
    if (options.stdin) {
      child.stdin.write(options.stdin);
    }
    child.stdin.end();
    child.on('close', (code) => {
      resolve({
        code: code ?? 1,
        stderr: Buffer.concat(stderrChunks).toString('utf8').trim(),
      });
    });
  });
}

async function which(bin: string): Promise<boolean> {
  const result = await runCommand('sh', ['-c', `command -v ${bin}`]);
  return result.code === 0;
}

function parseDatabaseUrl(databaseUrl: string): {
  user: string;
  password: string;
  database: string;
} {
  try {
    const url = new URL(databaseUrl);
    return {
      user: decodeURIComponent(url.username || 'knowledge_hub'),
      password: decodeURIComponent(url.password || ''),
      database: decodeURIComponent(
        (url.pathname || '/knowledge_hub').replace(/^\//, '') || 'knowledge_hub',
      ),
    };
  } catch {
    return { user: 'knowledge_hub', password: '', database: 'knowledge_hub' };
  }
}

/** Prefer host pg_dump; fall back to docker exec into a running Postgres container. */
async function dumpToFile(outPath: string, databaseUrl: string): Promise<void> {
  if (await which('pg_dump')) {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        'pg_dump',
        [databaseUrl, '-Fc', '--no-owner', '--no-acl'],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );
      const out = createWriteStream(outPath);
      const stderrChunks: Buffer[] = [];
      child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));
      child.on('error', reject);
      void pipeline(child.stdout, out).catch(reject);
      child.on('close', (code) => {
        if (code === 0) {
          resolve();
          return;
        }
        void fs.unlink(outPath).catch(() => undefined);
        reject(
          new AppError({
            code: 'BACKUP_EXPORT_FAILED',
            message: `pg_dump failed (exit ${code}): ${Buffer.concat(stderrChunks)
              .toString('utf8')
              .trim()
              .slice(0, 500)}`,
            statusCode: 500,
          }),
        );
      });
    });
    return;
  }

  if (!(await which('docker'))) {
    throw new AppError({
      code: 'BACKUP_TOOLS_MISSING',
      message:
        'pg_dump is not available. Install postgresql-client, or run with Docker Postgres (POSTGRES_CONTAINER).',
      statusCode: 503,
    });
  }

  const container =
    process.env.POSTGRES_CONTAINER ||
    (await (async () => {
      const listed = await new Promise<string>((resolve, reject) => {
        const child = spawn('docker', ['ps', '--format', '{{.Names}}'], {
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        const chunks: Buffer[] = [];
        child.stdout.on('data', (c: Buffer) => chunks.push(c));
        child.on('error', reject);
        child.on('close', (code) => {
          if (code !== 0) {
            resolve('');
            return;
          }
          resolve(Buffer.concat(chunks).toString('utf8'));
        });
      });
      const names = listed.split('\n').map((n) => n.trim()).filter(Boolean);
      return (
        names.find((n) => n.includes('postgres') && n.includes('knowledge')) ||
        names.find((n) => n.includes('postgres')) ||
        null
      );
    })());

  if (!container) {
    throw new AppError({
      code: 'BACKUP_TOOLS_MISSING',
      message:
        'pg_dump missing and no Postgres container found. Set POSTGRES_CONTAINER or install postgresql-client.',
      statusCode: 503,
    });
  }

  const creds = parseDatabaseUrl(databaseUrl);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      'docker',
      [
        'exec',
        '-e',
        `PGPASSWORD=${creds.password}`,
        container,
        'pg_dump',
        '-U',
        creds.user,
        '-d',
        creds.database,
        '-Fc',
        '--no-owner',
        '--no-acl',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const out = createWriteStream(outPath);
    const stderrChunks: Buffer[] = [];
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));
    child.on('error', reject);
    void pipeline(child.stdout, out).catch(reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      void fs.unlink(outPath).catch(() => undefined);
      reject(
        new AppError({
          code: 'BACKUP_EXPORT_FAILED',
          message: `docker pg_dump failed (exit ${code}): ${Buffer.concat(stderrChunks)
            .toString('utf8')
            .trim()
            .slice(0, 500)}`,
          statusCode: 500,
        }),
      );
    });
  });
}

export async function exportDatabaseDump(input: {
  backupDir: string;
  databaseUrl: string;
  schemaVersion: string;
}): Promise<{ artifact: BackupArtifact; stamp: BackupStamp }> {
  await ensureBackupDir(input.backupDir);
  const name = `knowledge-hub-${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}.dump`;
  const outPath = path.join(input.backupDir, name);

  await dumpToFile(outPath, input.databaseUrl);

  const stat = await fs.stat(outPath);
  if (stat.size <= 0) {
    await fs.unlink(outPath).catch(() => undefined);
    throw new AppError({
      code: 'BACKUP_EXPORT_FAILED',
      message: 'pg_dump produced an empty file',
      statusCode: 500,
    });
  }

  try {
    await fs.symlink(name, path.join(input.backupDir, 'latest.dump'));
  } catch {
    try {
      await fs.unlink(path.join(input.backupDir, 'latest.dump'));
      await fs.symlink(name, path.join(input.backupDir, 'latest.dump'));
    } catch {
      // optional convenience link
    }
  }

  const stamp: BackupStamp = {
    kind: 'backup',
    at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    artifact: outPath,
    schemaVersion: input.schemaVersion,
    hostname: process.env.HOSTNAME ?? 'api',
  };
  await writeStamp(input.backupDir, 'last-success.json', stamp);

  return {
    artifact: {
      name,
      sizeBytes: stat.size,
      modifiedAt: stat.mtime.toISOString(),
    },
    stamp,
  };
}

export async function importDatabaseDump(input: {
  backupDir: string;
  databaseUrl: string;
  dumpPath: string;
  schemaVersion: string;
}): Promise<{ stamp: BackupStamp }> {
  const resolved = path.resolve(input.dumpPath);
  const backupRoot = path.resolve(input.backupDir);
  if (!resolved.startsWith(backupRoot + path.sep) && resolved !== backupRoot) {
    throw new AppError({
      code: 'BACKUP_INVALID_PATH',
      message: 'Import dump must live under BACKUP_DIR',
      statusCode: 400,
    });
  }

  const hasPgRestore = await which('pg_restore');
  if (hasPgRestore) {
    const result = await runCommand('pg_restore', [
      '-d',
      input.databaseUrl,
      '--clean',
      '--if-exists',
      '--no-owner',
      '--no-acl',
      resolved,
    ]);
    if (result.code !== 0 && result.code !== 1) {
      throw new AppError({
        code: 'BACKUP_IMPORT_FAILED',
        message: `pg_restore failed (exit ${result.code}): ${result.stderr.slice(0, 500)}`,
        statusCode: 500,
      });
    }
  } else if (await which('docker')) {
    const dumpBuffer = await fs.readFile(resolved);
    const creds = parseDatabaseUrl(input.databaseUrl);
    const container =
      process.env.POSTGRES_CONTAINER ||
      (await (async () => {
        const listed = await new Promise<string>((resolve, reject) => {
          const child = spawn('docker', ['ps', '--format', '{{.Names}}'], {
            stdio: ['ignore', 'pipe', 'pipe'],
          });
          const chunks: Buffer[] = [];
          child.stdout.on('data', (c: Buffer) => chunks.push(c));
          child.on('error', reject);
          child.on('close', (code) => {
            resolve(code === 0 ? Buffer.concat(chunks).toString('utf8') : '');
          });
        });
        const names = listed.split('\n').map((n) => n.trim()).filter(Boolean);
        return (
          names.find((n) => n.includes('postgres') && n.includes('knowledge')) ||
          names.find((n) => n.includes('postgres')) ||
          null
        );
      })());
    if (!container) {
      throw new AppError({
        code: 'BACKUP_TOOLS_MISSING',
        message:
          'pg_restore missing and no Postgres container found. Set POSTGRES_CONTAINER or install postgresql-client.',
        statusCode: 503,
      });
    }
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        'docker',
        [
          'exec',
          '-i',
          '-e',
          `PGPASSWORD=${creds.password}`,
          container,
          'pg_restore',
          '-U',
          creds.user,
          '-d',
          creds.database,
          '--clean',
          '--if-exists',
          '--no-owner',
          '--no-acl',
        ],
        { stdio: ['pipe', 'ignore', 'pipe'] },
      );
      const stderrChunks: Buffer[] = [];
      child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));
      child.on('error', reject);
      child.stdin.write(dumpBuffer);
      child.stdin.end();
      child.on('close', (code) => {
        if (code === 0 || code === 1) {
          resolve();
          return;
        }
        reject(
          new AppError({
            code: 'BACKUP_IMPORT_FAILED',
            message: `docker pg_restore failed (exit ${code}): ${Buffer.concat(stderrChunks)
              .toString('utf8')
              .trim()
              .slice(0, 500)}`,
            statusCode: 500,
          }),
        );
      });
    });
  } else {
    throw new AppError({
      code: 'BACKUP_TOOLS_MISSING',
      message:
        'pg_restore is not available. Install postgresql-client or use Docker Postgres.',
      statusCode: 503,
    });
  }

  const stamp: BackupStamp = {
    kind: 'import',
    at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    artifact: resolved,
    schemaVersion: input.schemaVersion,
    hostname: process.env.HOSTNAME ?? 'api',
  };
  await writeStamp(input.backupDir, 'last-import.json', stamp);
  return { stamp };
}

export async function saveUploadedDump(
  backupDir: string,
  buffer: Buffer,
  suggestedName?: string,
): Promise<string> {
  await ensureBackupDir(backupDir);
  const name =
    suggestedName && DUMP_NAME_RE.test(path.basename(suggestedName))
      ? path.basename(suggestedName)
      : `knowledge-hub-upload-${new Date()
          .toISOString()
          .replace(/[-:]/g, '')
          .replace(/\.\d{3}Z$/, 'Z')}.dump`;
  const outPath = path.join(backupDir, name);
  await fs.writeFile(outPath, buffer);
  return name;
}

export function dumpFilePath(backupDir: string, name: string): string {
  return path.join(backupDir, assertSafeDumpName(name));
}

export async function deleteDumpArtifact(
  backupDir: string,
  name: string,
): Promise<void> {
  const safe = assertSafeDumpName(name);
  const filePath = path.join(backupDir, safe);
  try {
    await fs.unlink(filePath);
  } catch {
    throw new AppError({
      code: 'BACKUP_NOT_FOUND',
      message: 'Dump artifact not found',
      statusCode: 404,
    });
  }

  const latestPath = path.join(backupDir, 'latest.dump');
  try {
    const link = await fs.readlink(latestPath);
    if (path.basename(link) === safe || link === safe) {
      await fs.unlink(latestPath).catch(() => undefined);
      const remaining = await listDumpArtifacts(backupDir, 1);
      if (remaining[0]) {
        await fs.symlink(remaining[0].name, latestPath).catch(() => undefined);
      }
    }
  } catch {
    // latest.dump may be missing or not a symlink
  }
}

export type RotateResult = {
  kept: number;
  deleted: string[];
};

/** Retention: keep all within keepDaily days; then ≤keepWeekly one-per-ISO-week; then ≤keepMonthly one-per-month. */
export async function rotateDumpArtifacts(
  backupDir: string,
  policy: { keepDaily: number; keepWeekly: number; keepMonthly: number },
): Promise<RotateResult> {
  await ensureBackupDir(backupDir);
  let entries: string[];
  try {
    entries = await fs.readdir(backupDir);
  } catch {
    return { kept: 0, deleted: [] };
  }

  type Entry = { name: string; full: string; mtimeMs: number };
  const files: Entry[] = [];
  for (const name of entries) {
    if (!DUMP_NAME_RE.test(name)) continue;
    const full = path.join(backupDir, name);
    try {
      const stat = await fs.stat(full);
      if (!stat.isFile()) continue;
      files.push({ name, full, mtimeMs: stat.mtimeMs });
    } catch {
      // skip
    }
  }

  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const now = Date.now();
  const keep = new Set<string>();
  const seenWeek = new Set<string>();
  const seenMonth = new Set<string>();
  let weeklyCount = 0;
  let monthlyCount = 0;

  for (const file of files) {
    const ageDays = Math.floor((now - file.mtimeMs) / 86_400_000);
    const date = new Date(file.mtimeMs);
    const weekKey = isoWeekKey(date);
    const monthKey = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;

    if (ageDays < policy.keepDaily) {
      keep.add(file.name);
      continue;
    }

    const weeklyHorizon = policy.keepDaily + 7 * policy.keepWeekly;
    if (ageDays < weeklyHorizon) {
      if (!seenWeek.has(weekKey) && weeklyCount < policy.keepWeekly) {
        keep.add(file.name);
        seenWeek.add(weekKey);
        weeklyCount += 1;
      }
      continue;
    }

    const monthlyHorizon = weeklyHorizon + 31 * policy.keepMonthly;
    if (ageDays < monthlyHorizon) {
      if (!seenMonth.has(monthKey) && monthlyCount < policy.keepMonthly) {
        keep.add(file.name);
        seenMonth.add(monthKey);
        monthlyCount += 1;
      }
    }
  }

  const deleted: string[] = [];
  for (const file of files) {
    if (keep.has(file.name)) continue;
    await fs.unlink(file.full).catch(() => undefined);
    deleted.push(file.name);
  }

  return { kept: keep.size, deleted };
}

function isoWeekKey(date: Date): string {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((target.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
