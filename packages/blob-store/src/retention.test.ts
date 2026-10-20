import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
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
  for (const item of items) {
    const full = path.join(dir, item.id);
    await writeFile(full, 'dump');
    await execFileAsync('touch', ['-d', `@${Math.floor(item.mtimeMs / 1000)}`, full]);
  }
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
    const nowMs = Math.floor(Date.now() / 1000) * 1000;
    const items = pile(nowMs);
    const dir = await mkdtemp(path.join(tmpdir(), 'kh-backup-rotate-'));
    await materialize(dir, items);

    const expected = selectRetainedBackupIds(items, POLICY, Date.now());
    await execFileAsync('bash', [rotateScript], {
      env: {
        ...process.env,
        BACKUP_DIR: dir,
        BACKUP_KEEP_DAILY: '7',
        BACKUP_KEEP_WEEKLY: '4',
        BACKUP_KEEP_MONTHLY: '3',
        BACKUP_FORCE_ROTATE: '1',
      },
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
  });

  it('dry-run deletes nothing', async () => {
    const nowMs = Math.floor(Date.now() / 1000) * 1000;
    const items = pile(nowMs);
    const dir = await mkdtemp(path.join(tmpdir(), 'kh-backup-dry-'));
    await materialize(dir, items);
    await execFileAsync('bash', [rotateScript], {
      env: {
        ...process.env,
        BACKUP_DIR: dir,
        BACKUP_DRY_RUN: '1',
        BACKUP_KEEP_DAILY: '7',
        BACKUP_KEEP_WEEKLY: '4',
        BACKUP_KEEP_MONTHLY: '3',
      },
    });
    const remaining = (await readdir(dir)).filter((name) => name.endsWith('.dump'));
    expect(remaining).toHaveLength(items.length);
    await expect(readFile(path.join(dir, 'last-local-rotation.json'), 'utf8')).rejects.toThrow();
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
