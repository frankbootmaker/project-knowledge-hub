/**
 * Shared backup retention selection.
 * The sidecar (`rotate-backups.sh`) implements the same rules.
 *
 * Daily tier: at most one dump per UTC day, for the newest `keepDaily` days
 * inside the daily age window. The single newest dump is always kept, including
 * when it sits outside that window.
 * Then at most `keepWeekly` dumps, one per ISO week, then `keepMonthly`, one per
 * UTC month. Anything older is dropped.
 */

export type RetentionPolicy = {
  keepDaily: number;
  keepWeekly: number;
  keepMonthly: number;
};

export type RetentionCandidate = {
  id: string;
  mtimeMs: number;
};

const DAY_MS = 86_400_000;

export function selectRetainedBackupIds(
  items: readonly RetentionCandidate[],
  policy: RetentionPolicy,
  nowMs: number,
): Set<string> {
  const sorted = [...items].sort((a, b) => b.mtimeMs - a.mtimeMs || a.id.localeCompare(b.id));
  const keep = new Set<string>();
  const newest = sorted[0];
  if (!newest) return keep;
  keep.add(newest.id);

  const seenDay = new Set<string>();
  const seenWeek = new Set<string>();
  const seenMonth = new Set<string>();
  let dailyCount = 0;
  let weeklyCount = 0;
  let monthlyCount = 0;
  const weeklyHorizon = policy.keepDaily + 7 * policy.keepWeekly;
  const monthlyHorizon = weeklyHorizon + 31 * policy.keepMonthly;

  for (const item of sorted) {
    const ageDays = Math.floor((nowMs - item.mtimeMs) / DAY_MS);
    const date = new Date(item.mtimeMs);
    const dayKey = date.toISOString().slice(0, 10);
    const weekKey = isoWeekKey(date);
    const monthKey = date.toISOString().slice(0, 7);

    if (ageDays < policy.keepDaily) {
      if (!seenDay.has(dayKey) && dailyCount < policy.keepDaily) {
        keep.add(item.id);
        seenDay.add(dayKey);
        dailyCount += 1;
      }
      continue;
    }

    if (ageDays < weeklyHorizon) {
      if (!seenWeek.has(weekKey) && weeklyCount < policy.keepWeekly) {
        keep.add(item.id);
        seenWeek.add(weekKey);
        weeklyCount += 1;
      }
      continue;
    }

    if (ageDays < monthlyHorizon) {
      if (!seenMonth.has(monthKey) && monthlyCount < policy.keepMonthly) {
        keep.add(item.id);
        seenMonth.add(monthKey);
        monthlyCount += 1;
      }
    }
  }

  return keep;
}

/** ISO week key `YYYY-Www` (UTC), matching `date -u +%G-W%V`. */
export function isoWeekKey(date: Date): string {
  const target = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const dayNum = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNum);
  const isoYear = target.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const week = Math.ceil(
    ((target.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7,
  );
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}
