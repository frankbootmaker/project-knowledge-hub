import { createWriteStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { resolveDatabaseUrl } from '@project-knowledge-hub/config';
import { ensureMigrationJournalAfterRestore } from '@project-knowledge-hub/database';
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
  fileName: 'last-success.json' | 'last-import.json' | 'last-failure.json',
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

export type SchedulerHeartbeat = {
  kind: string;
  at: string;
  status: string;
  nextDueAt: string;
  detail: string;
  hostname: string;
};

/** Sidecar writes scheduler-heartbeat.json about once a minute while alive. */
export async function readSchedulerHeartbeat(
  backupDir: string,
): Promise<SchedulerHeartbeat | null> {
  const stampPath = path.join(backupDir, 'scheduler-heartbeat.json');
  try {
    const raw = await fs.readFile(stampPath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<SchedulerHeartbeat>;
    if (!parsed.at || typeof parsed.at !== 'string') return null;
    return {
      kind: typeof parsed.kind === 'string' ? parsed.kind : 'scheduler_heartbeat',
      at: parsed.at,
      status: typeof parsed.status === 'string' ? parsed.status : 'unknown',
      nextDueAt: typeof parsed.nextDueAt === 'string' ? parsed.nextDueAt : '',
      detail: typeof parsed.detail === 'string' ? parsed.detail : '',
      hostname: typeof parsed.hostname === 'string' ? parsed.hostname : 'unknown',
    };
  } catch {
    return null;
  }
}

/** True when the sidecar has checked in recently (default: 5 minutes). */
export function isSchedulerHeartbeatFresh(
  ageSeconds: number | null,
  maxAgeSeconds = 300,
): boolean {
  if (ageSeconds == null) return false;
  return ageSeconds <= maxAgeSeconds;
}

export async function writeStamp(
  backupDir: string,
  fileName: 'last-success.json' | 'last-import.json' | 'last-failure.json',
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
  host: string;
  port: string;
} {
  try {
    const url = new URL(databaseUrl);
    return {
      user: decodeURIComponent(url.username || 'knowledge_hub'),
      password: decodeURIComponent(url.password || ''),
      database: decodeURIComponent(
        (url.pathname || '/knowledge_hub').replace(/^\//, '') || 'knowledge_hub',
      ),
      host: url.hostname || 'localhost',
      port: url.port || '5432',
    };
  } catch {
    return {
      user: 'knowledge_hub',
      password: '',
      database: 'knowledge_hub',
      host: 'localhost',
      port: '5432',
    };
  }
}

/**
 * Credentials for pg_dump / pg_restore / psql.
 * Prefer discrete POSTGRES_* (same as migrate) so Compose-mangled DATABASE_URL
 * or URL round-trip quirks cannot produce a wrong PGPASSWORD.
 */
function resolveToolDbCreds(fallbackDatabaseUrl: string): {
  user: string;
  password: string;
  database: string;
  host: string;
  port: string;
  connectionString: string;
} {
  const discretePassword = process.env.POSTGRES_PASSWORD;
  if (typeof discretePassword === 'string' && discretePassword.length > 0) {
    return {
      user: process.env.POSTGRES_USER?.trim() || 'knowledge_hub',
      password: discretePassword,
      database: process.env.POSTGRES_DB?.trim() || 'knowledge_hub',
      host: process.env.POSTGRES_HOST?.trim() || 'postgres',
      port: process.env.POSTGRES_PORT?.trim() || '5432',
      connectionString: resolveDatabaseUrl(process.env),
    };
  }
  const connectionString = fallbackDatabaseUrl;
  return { ...parseDatabaseUrl(connectionString), connectionString };
}

/** Name of a running Postgres container, for hosts without postgresql-client. */
async function findPostgresContainer(): Promise<string | null> {
  if (process.env.POSTGRES_CONTAINER) {
    return process.env.POSTGRES_CONTAINER;
  }
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
}

function pgAuthFailureMessage(stderr: string, tool: string): string | null {
  if (!/28P01|password authentication failed/i.test(stderr)) {
    return null;
  }
  return (
    `${tool} could not authenticate to Postgres (28P01). ` +
    'POSTGRES_PASSWORD in Dokploy must match the role password stored in the ' +
    'Postgres volume (set at first init). Fix with ALTER USER … PASSWORD … or ' +
    'wipe the volume; avoid $ in passwords (Compose interpolates).'
  );
}

async function runPsqlOnDatabase(
  databaseUrl: string,
  sql: string,
  failureMessage: string,
): Promise<void> {
  const creds = resolveToolDbCreds(databaseUrl);

  if (await which('psql')) {
    const result = await runCommand(
      'psql',
      [
        '-h',
        creds.host,
        '-p',
        creds.port,
        '-U',
        creds.user,
        '-d',
        creds.database,
        '-v',
        'ON_ERROR_STOP=1',
        '-c',
        sql,
      ],
      { env: { PGPASSWORD: creds.password } },
    );
    if (result.code !== 0) {
      const authHint = pgAuthFailureMessage(result.stderr, 'psql');
      throw new AppError({
        code: 'BACKUP_IMPORT_FAILED',
        message:
          authHint ?? `${failureMessage}: ${result.stderr.slice(0, 400)}`,
        statusCode: 500,
      });
    }
    return;
  }

  if (await which('docker')) {
    const container = await findPostgresContainer();
    if (container) {
      const result = await runCommand(
        'docker',
        [
          'exec',
          '-e',
          `PGPASSWORD=${creds.password}`,
          container,
          'psql',
          '-U',
          creds.user,
          '-d',
          creds.database,
          '-v',
          'ON_ERROR_STOP=1',
          '-c',
          sql,
        ],
      );
      if (result.code !== 0) {
        const authHint = pgAuthFailureMessage(result.stderr, 'psql');
        throw new AppError({
          code: 'BACKUP_IMPORT_FAILED',
          message:
            authHint ?? `${failureMessage}: ${result.stderr.slice(0, 400)}`,
          statusCode: 500,
        });
      }
      return;
    }
  }

  throw new AppError({
    code: 'BACKUP_TOOLS_MISSING',
    message: `${failureMessage}: psql is not available on the API image`,
    statusCode: 503,
  });
}

/** Kick other backends so schema wipe / pg_restore can replace objects. */
export async function terminateOtherDbSessions(databaseUrl: string): Promise<void> {
  const sql =
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid();";
  await runPsqlOnDatabase(
    databaseUrl,
    sql,
    'Could not terminate DB sessions before import',
  );
}

/**
 * Full-replace prep: drop app schemas so pg_restore --clean is not blocked by
 * tables that exist only on the target (e.g. workspace_media FKs when the dump
 * is older). Recreate empty public; dump restores extensions/objects.
 */
export async function wipeDatabaseSchemasForImport(
  databaseUrl: string,
): Promise<void> {
  const creds = resolveToolDbCreds(databaseUrl);
  const owner = quoteIdent(creds.user);
  const sql = `
SELECT pg_terminate_backend(pid)
  FROM pg_stat_activity
  WHERE datname = current_database() AND pid <> pg_backend_pid();
DROP SCHEMA IF EXISTS drizzle CASCADE;
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public AUTHORIZATION ${owner};
GRANT ALL ON SCHEMA public TO ${owner};
GRANT ALL ON SCHEMA public TO public;
COMMENT ON SCHEMA public IS 'standard public schema';
`;
  await runPsqlOnDatabase(
    databaseUrl,
    sql,
    'Could not wipe schemas before import',
  );
}

/** Quote a Postgres identifier (simple unquoted-safe names only). */
function quoteIdent(ident: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(ident)) {
    throw new AppError({
      code: 'BACKUP_IMPORT_FAILED',
      message: `Refusing schema wipe with unsafe database role name: ${ident}`,
      statusCode: 500,
    });
  }
  return `"${ident}"`;
}

function isHardPgRestoreFailure(stderr: string): boolean {
  return /cannot drop table|already exists|multiple primary keys|fatal|could not|permission denied/i.test(
    stderr,
  );
}

type RestoreMode =
  | { kind: 'host' }
  | { kind: 'docker'; container: string };

/** Decide how the restore will run *before* anything destructive happens. */
async function resolveRestoreMode(): Promise<RestoreMode> {
  if (await which('pg_restore')) {
    return { kind: 'host' };
  }
  if (await which('docker')) {
    const container = await findPostgresContainer();
    if (container) {
      return { kind: 'docker', container };
    }
  }
  throw new AppError({
    code: 'BACKUP_TOOLS_MISSING',
    message:
      'pg_restore is not available and no Postgres container was found. Install postgresql-client or set POSTGRES_CONTAINER.',
    statusCode: 503,
  });
}

/**
 * Import preflight: the dump must be a readable custom-format archive and the
 * credentials must work. Checked before the schema wipe so a bad password or a
 * truncated upload leaves the existing database untouched.
 */
async function assertImportPreflight(input: {
  mode: RestoreMode;
  dumpPath: string;
  databaseUrl: string;
}): Promise<void> {
  const listResult =
    input.mode.kind === 'host'
      ? await runCommand('pg_restore', ['--list', input.dumpPath])
      : await runCommand(
          'docker',
          ['exec', '-i', input.mode.container, 'pg_restore', '--list'],
          { stdin: await fs.readFile(input.dumpPath) },
        );
  if (listResult.code !== 0) {
    throw new AppError({
      code: 'BACKUP_IMPORT_FAILED',
      message: `Dump is not a readable pg_dump -Fc archive; database left unchanged: ${listResult.stderr.slice(
        0,
        400,
      )}`,
      statusCode: 400,
    });
  }

  await runPsqlOnDatabase(
    input.databaseUrl,
    'SELECT 1;',
    'Import preflight failed; database left unchanged',
  );
}

async function streamDumpCommand(
  command: string,
  args: string[],
  outPath: string,
  env?: NodeJS.ProcessEnv,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const out = createWriteStream(outPath);
    const stderrChunks: Buffer[] = [];
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      void fs.unlink(outPath).catch(() => undefined);
      reject(error);
    };

    child.on('error', (error) => fail(error));

    const pipelineDone = pipeline(child.stdout, out).catch((error: Error) => {
      fail(error);
    });

    child.on('close', (code) => {
      void pipelineDone.finally(() => {
        if (settled) return;
        if (code === 0) {
          settled = true;
          resolve();
          return;
        }
        fail(
          new AppError({
            code: 'BACKUP_EXPORT_FAILED',
            message: `${command} failed (exit ${code}): ${Buffer.concat(stderrChunks)
              .toString('utf8')
              .trim()
              .slice(0, 500)}`,
            statusCode: 500,
          }),
        );
      });
    });
  });
}

/** Prefer host pg_dump; fall back to docker exec into a running Postgres container. */
async function dumpToFile(outPath: string, databaseUrl: string): Promise<void> {
  const creds = resolveToolDbCreds(databaseUrl);

  if (await which('pg_dump')) {
    await streamDumpCommand(
      'pg_dump',
      [
        '-h',
        creds.host,
        '-p',
        creds.port,
        '-U',
        creds.user,
        '-d',
        creds.database,
        '-Fc',
        '--no-owner',
        '--no-acl',
      ],
      outPath,
      { PGPASSWORD: creds.password },
    );
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

  const container = await findPostgresContainer();
  if (!container) {
    throw new AppError({
      code: 'BACKUP_TOOLS_MISSING',
      message:
        'pg_dump missing and no Postgres container found. Set POSTGRES_CONTAINER or install postgresql-client.',
      statusCode: 503,
    });
  }

  await streamDumpCommand(
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
    outPath,
  );
}

export async function exportDatabaseDump(input: {
  backupDir: string;
  databaseUrl: string;
  schemaVersion: string;
}): Promise<{ artifact: BackupArtifact; stamp: BackupStamp }> {
  try {
    await ensureBackupDir(input.backupDir);
  } catch (err) {
    const code = errnoCode(err);
    if (code === 'EACCES' || code === 'EPERM') {
      throw new AppError({
        code: 'BACKUP_PERMISSION_DENIED',
        message:
          'Cannot write BACKUP_DIR (permission denied). The backups volume must be writable by the API user (uid 1001).',
        statusCode: 503,
      });
    }
    throw err;
  }
  const name = `knowledge-hub-${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}.dump`;
  const outPath = path.join(input.backupDir, name);

  try {
    await dumpToFile(outPath, input.databaseUrl);
  } catch (err) {
    const code = errnoCode(err);
    if (code === 'EACCES' || code === 'EPERM') {
      throw new AppError({
        code: 'BACKUP_PERMISSION_DENIED',
        message:
          'Cannot write dump under BACKUP_DIR (permission denied). The backups volume must be writable by the API user (uid 1001).',
        statusCode: 503,
      });
    }
    throw err;
  }

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
}): Promise<{ stamp: BackupStamp; journalWarning?: string }> {
  const resolved = path.resolve(input.dumpPath);
  const backupRoot = path.resolve(input.backupDir);
  if (!resolved.startsWith(backupRoot + path.sep) && resolved !== backupRoot) {
    throw new AppError({
      code: 'BACKUP_INVALID_PATH',
      message: 'Import dump must live under BACKUP_DIR',
      statusCode: 400,
    });
  }

  const mode = await resolveRestoreMode();
  await assertImportPreflight({
    mode,
    dumpPath: resolved,
    databaseUrl: input.databaseUrl,
  });

  // Live API/worker pools hold locks; target may also have newer tables (e.g.
  // workspace_media) that block pg_restore --clean DROP without CASCADE.
  await wipeDatabaseSchemasForImport(input.databaseUrl);

  if (mode.kind === 'host') {
    const creds = resolveToolDbCreds(input.databaseUrl);
    const result = await runCommand(
      'pg_restore',
      [
        '-h',
        creds.host,
        '-p',
        creds.port,
        '-U',
        creds.user,
        '-d',
        creds.database,
        '--clean',
        '--if-exists',
        '--no-owner',
        '--no-acl',
        resolved,
      ],
      { env: { PGPASSWORD: creds.password } },
    );
    if (result.code !== 0 && result.code !== 1) {
      const authHint = pgAuthFailureMessage(result.stderr, 'pg_restore');
      throw new AppError({
        code: 'BACKUP_IMPORT_FAILED',
        message:
          authHint ??
          `pg_restore failed (exit ${result.code}): ${result.stderr.slice(0, 500)}`,
        statusCode: 500,
      });
    }
    if (result.code === 1 && isHardPgRestoreFailure(result.stderr)) {
      const authHint = pgAuthFailureMessage(result.stderr, 'pg_restore');
      const snippet = result.stderr.slice(0, 500);
      throw new AppError({
        code: 'BACKUP_IMPORT_FAILED',
        message: authHint ?? `pg_restore reported a hard error: ${snippet}`,
        statusCode: 500,
      });
    }
  } else {
    const dumpBuffer = await fs.readFile(resolved);
    const creds = resolveToolDbCreds(input.databaseUrl);
    const container = mode.container;
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
        const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
        if (code === 0 || (code === 1 && !isHardPgRestoreFailure(stderr))) {
          resolve();
          return;
        }
        reject(
          new AppError({
            code: 'BACKUP_IMPORT_FAILED',
            message: `docker pg_restore failed (exit ${code}): ${stderr.slice(0, 500)}`,
            statusCode: 500,
          }),
        );
      });
    });
  }

  // Schema wipe + restore can leave tables without drizzle.__drizzle_migrations.
  // Baseline so the next Dokploy migrate is a no-op (or only applies newer files).
  // Never fail the import after a successful restore — surface a warning instead.
  let journalWarning: string | undefined;
  try {
    const journal = await ensureMigrationJournalAfterRestore();
    if (journal.action === 'baselined') {
      console.warn(
        `Import: baselined drizzle journal through ${journal.throughTag} ` +
          `(idx ${journal.throughIdx}, ${journal.inserted} row(s))`,
      );
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message.slice(0, 400) : String(error);
    journalWarning =
      `Restore finished, but migration journal repair failed (${message}). ` +
      'Redeploy so migrate can baseline, or run baseline-journal manually.';
    console.error(`Import: ${journalWarning}`);
  }

  const stamp: BackupStamp = {
    kind: 'import',
    at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    artifact: resolved,
    schemaVersion: input.schemaVersion,
    hostname: process.env.HOSTNAME ?? 'api',
  };
  await writeStamp(input.backupDir, 'last-import.json', stamp);
  return { stamp, journalWarning };
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

function errnoCode(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

export async function deleteDumpArtifact(
  backupDir: string,
  name: string,
): Promise<void> {
  const safe = assertSafeDumpName(name);
  const filePath = path.join(backupDir, safe);
  try {
    await fs.unlink(filePath);
  } catch (err) {
    const code = errnoCode(err);
    if (code === 'ENOENT') {
      throw new AppError({
        code: 'BACKUP_NOT_FOUND',
        message: 'Dump artifact not found',
        statusCode: 404,
      });
    }
    if (code === 'EACCES' || code === 'EPERM') {
      throw new AppError({
        code: 'BACKUP_PERMISSION_DENIED',
        message:
          'Cannot delete dump under BACKUP_DIR (permission denied). The backups volume must be writable by the API user (uid 1001).',
        statusCode: 503,
      });
    }
    throw err;
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
