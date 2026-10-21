import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { selectRetainedBackupIds, type RetentionCandidate } from './retention.js';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const rotateScript = path.join(repoRoot, 'infrastructure/scripts/rotate-backups.sh');
const commonScript = path.join(repoRoot, 'infrastructure/scripts/lib/db-ops-common.sh');

const POLICY = { keepDaily: 7, keepWeekly: 4, keepMonthly: 3 };
/** Fixed UTC instant so the shell clock and the TypeScript policy cannot drift. */
const NOW_MS = Date.UTC(2026, 9, 20, 15, 0, 0);
const NOW_EPOCH = String(Math.floor(NOW_MS / 1000));

function pile(nowMs: number): RetentionCandidate[] {
  const items: RetentionCandidate[] = [];
  const nowSec = Math.floor(nowMs / 1000);
  const today = new Date(nowSec * 1000);
  const todayMidnight = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
  );

  for (let day = 0; day < 7; day += 1) {
    const dayStart = todayMidnight - day * 86_400_000;
    for (let slot = 0; slot < 5; slot += 1) {
      let mtime = dayStart + (slot + 1) * 3_600_000;
      if (mtime > nowSec * 1000 - 120_000) {
        mtime = nowSec * 1000 - (slot + 1) * 180_000;
      }
      if (mtime < dayStart) continue;
      const ageDays = Math.floor((nowSec * 1000 - mtime) / 86_400_000);
      if (ageDays >= 7) continue;
      items.push({
        id: `knowledge-hub-d${day}-s${slot}.dump`,
        mtimeMs: mtime,
      });
    }
  }

  items.push(
    { id: 'knowledge-hub-w16.dump', mtimeMs: (nowSec - 16 * 86_400) * 1000 },
    { id: 'knowledge-hub-w15.dump', mtimeMs: (nowSec - 15 * 86_400) * 1000 },
    { id: 'knowledge-hub-ancient.dump', mtimeMs: (nowSec - 400 * 86_400) * 1000 },
  );
  return items;
}

async function materialize(dir: string, items: RetentionCandidate[]): Promise<void> {
  // utimes is one syscall per file. The previous helper spawned touch(1) once
  // per dump; together with per-file date(1) in the rotator that exceeded
  // vitest's 5s default when turbo was running the rest of the suite.
  await Promise.all(
    items.map(async (item) => {
      const full = path.join(dir, item.id);
      await writeFile(full, 'dump');
      const seconds = Math.floor(item.mtimeMs / 1000);
      await utimes(full, seconds, seconds);
    }),
  );
}

function rotationEnv(dir: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    BACKUP_DIR: dir,
    BACKUP_KEEP_DAILY: String(POLICY.keepDaily),
    BACKUP_KEEP_WEEKLY: String(POLICY.keepWeekly),
    BACKUP_KEEP_MONTHLY: String(POLICY.keepMonthly),
    BACKUP_NOW_EPOCH: NOW_EPOCH,
    ...extra,
  };
}

/** PATH of the tools the date(1) fallback needs, with python3 hidden. */
async function pathWithoutPython(): Promise<{ bin: string; bash: string }> {
  const bin = await mkdtemp(path.join(tmpdir(), 'kh-nopython-'));
  const commands = [
    'bash', 'dirname', 'find', 'sort', 'awk',
    'stat', 'date', 'rm', 'mkdir', 'mktemp',
  ];
  const { stdout } = await execFileAsync('bash', ['-c', `command -v ${commands.join(' ')}`]);
  const paths = stdout.trim().split('\n');
  const bash = paths[0];
  if (!bash || paths.length !== commands.length) {
    throw new Error(`missing tools for date fallback: ${stdout}`);
  }
  for (let i = 1; i < commands.length; i += 1) {
    const target = paths[i];
    if (!target) throw new Error(`missing ${commands[i]}`);
    await symlink(target, path.join(bin, commands[i]!));
  }
  return { bin, bash };
}

describe('selectRetainedBackupIds', () => {
  it('keeps at most one dump per day inside a 7-day pile, plus the newest', () => {
    const nowMs = Math.floor(Date.now() / 1000) * 1000;
    const items = pile(nowMs);
    expect(items.filter((item) => item.id.startsWith('knowledge-hub-d')).length).toBeGreaterThan(
      7,
    );

    const keep = selectRetainedBackupIds(items, POLICY, nowMs);
    const daily = items.filter((item) => item.id.startsWith('knowledge-hub-d'));
    const keptDaily = daily.filter((item) => keep.has(item.id));
    const days = new Set(keptDaily.map((item) => new Date(item.mtimeMs).toISOString().slice(0, 10)));

    expect(keptDaily.length).toBeLessThanOrEqual(7);
    expect(keptDaily.length).toBe(days.size);
    const newest = [...items].sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
    expect(newest).toBeDefined();
    expect(keep.has(newest!.id)).toBe(true);
    expect(keep.has('knowledge-hub-ancient.dump')).toBe(false);

    const sameDay = keptDaily.filter(
      (item) => new Date(item.mtimeMs).toISOString().slice(0, 10) === new Date(newest!.mtimeMs).toISOString().slice(0, 10),
    );
    expect(sameDay.map((item) => item.id)).toEqual([newest!.id]);
  });

  it('still keeps the newest dump when every copy is older than the daily window', () => {
    const nowMs = Date.UTC(2026, 9, 20, 12, 0, 0);
    const items = [1, 2, 3].map((n) => ({
      id: `knowledge-hub-old-${n}.dump`,
      mtimeMs: nowMs - (100 + n) * 86_400_000,
    }));
    const keep = selectRetainedBackupIds(items, { keepDaily: 7, keepWeekly: 0, keepMonthly: 0 }, nowMs);
    expect([...keep]).toEqual(['knowledge-hub-old-1.dump']);
  });
});

describe('rotate-backups.sh', () => {
  it('prunes the same dumps as the TypeScript policy', async () => {
    const items = pile(NOW_MS);
    const dir = await mkdtemp(path.join(tmpdir(), 'kh-backup-rotate-'));
    try {
      await materialize(dir, items);

      const expected = selectRetainedBackupIds(items, POLICY, NOW_MS);
      await execFileAsync('bash', [rotateScript], {
        env: rotationEnv(dir, { BACKUP_FORCE_ROTATE: '1' }),
      });

      const remaining = (await readdir(dir)).filter((name) => name.endsWith('.dump'));
      expect(new Set(remaining)).toEqual(expected);
      expect(remaining).not.toContain('knowledge-hub-ancient.dump');

      const stamp = JSON.parse(
        await readFile(path.join(dir, 'last-local-rotation.json'), 'utf8'),
      ) as { kept: number; deleted: number; error: string | null };
      expect(stamp.error).toBeNull();
      expect(stamp.kept).toBe(expected.size);
      expect(stamp.deleted).toBe(items.length - expected.size);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('dry-run deletes nothing', async () => {
    const items = pile(NOW_MS);
    const dir = await mkdtemp(path.join(tmpdir(), 'kh-backup-dry-'));
    try {
      await materialize(dir, items);
      await execFileAsync('bash', [rotateScript], {
        env: rotationEnv(dir, { BACKUP_DRY_RUN: '1' }),
      });
      const remaining = (await readdir(dir)).filter((name) => name.endsWith('.dump'));
      expect(remaining).toHaveLength(items.length);
      await expect(readFile(path.join(dir, 'last-local-rotation.json'), 'utf8')).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('date fallback keeps the same dumps as the python fast path', async () => {
    const all = pile(NOW_MS);
    const items = [...all.slice(0, 3), ...all.slice(-3)];
    const dir = await mkdtemp(path.join(tmpdir(), 'kh-backup-fallback-'));
    const hidden = await pathWithoutPython();
    try {
      await materialize(dir, items);
      const withPython = await execFileAsync('bash', [rotateScript], {
        env: rotationEnv(dir, { BACKUP_DRY_RUN: '1' }),
      });
      const withoutPython = await execFileAsync(hidden.bash, [rotateScript], {
        env: rotationEnv(dir, { BACKUP_DRY_RUN: '1', PATH: hidden.bin }),
      });
      const deleted = (stdout: string) =>
        stdout
          .split('\n')
          .filter((line) => line.startsWith('Would delete:'))
          .sort();
      expect(deleted(withoutPython.stdout)).toEqual(deleted(withPython.stdout));
      const remaining = (await readdir(dir)).filter((name) => name.endsWith('.dump'));
      expect(remaining).toHaveLength(items.length);
    } finally {
      await rm(dir, { recursive: true, force: true });
      await rm(hidden.bin, { recursive: true, force: true });
    }
  });
});

describe('startup backup skip', () => {
  it('skips when the last success is younger than the threshold', async () => {
    const { stdout } = await execFileAsync('bash', [
      '-c',
      `
        source "${commonScript}"
        db_ops_startup_backup_action 1 true 100 3600
        db_ops_startup_backup_action 1 true 4000 3600
        db_ops_startup_backup_action 1 true "" 3600
        db_ops_startup_backup_action 1 true 10 0
        db_ops_startup_backup_action 0 true 10 3600
        db_ops_startup_backup_action 1 false 10 3600
      `,
    ]);
    expect(stdout.trim().split('\n')).toEqual([
      'skip',
      'run',
      'run',
      'run',
      'disabled',
      'schedule_off',
    ]);
  });
});
