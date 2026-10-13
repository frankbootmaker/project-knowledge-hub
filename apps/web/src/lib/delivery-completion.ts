/** Derived delivery completion. Parents average child task percents. */

export type DeliveryCompletion = {
  percent: number;
  /** Share of children finished, including partial steps such as 0.5. */
  done: number;
  total: number;
};

export type DeliveryCompletionTask = {
  status: string;
  completionPercent?: number | null;
  userStoryId: string | null;
  epicId: string | null;
};

export type DeliveryCompletionIndex = {
  byStoryId: Map<string, DeliveryCompletion>;
  byEpicId: Map<string, DeliveryCompletion>;
};

type Bucket = {
  earned: number;
  total: number;
};

/** Done is 100. Cancelled is omitted. An open task uses its stored step, or 0. */
export function taskCompletionPoints(
  status: string,
  completionPercent?: number | null,
): number | null {
  if (status === 'cancelled') return null;
  if (status === 'done') return 100;
  if (typeof completionPercent === 'number') return completionPercent;
  return 0;
}

export function taskDeliveryCompletion(
  status: string,
  completionPercent?: number | null,
): DeliveryCompletion | null {
  const points = taskCompletionPoints(status, completionPercent);
  if (points == null) return null;
  return { percent: points, done: points / 100, total: 1 };
}

function bump(buckets: Map<string, Bucket>, id: string | null, points: number | null) {
  if (!id || points == null) return;
  const bucket = buckets.get(id) ?? { earned: 0, total: 0 };
  bucket.earned += points;
  bucket.total += 1;
  buckets.set(id, bucket);
}

function toCompletion(bucket: Bucket): DeliveryCompletion {
  return {
    percent: Math.round(bucket.earned / bucket.total),
    done: bucket.earned / 100,
    total: bucket.total,
  };
}

/** Local calendar day as YYYY-MM-DD. */
export function localDateIso(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function utcDay(isoDate: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return Number.NaN;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Share of a start–end window that should be finished today.
 * The start day is 0. The end day, and every day after it, is 100.
 * A missing or reversed window has no target.
 */
export function plannedTargetPercent(
  start: string | null | undefined,
  end: string | null | undefined,
  today: string,
): number | null {
  if (!start || !end || !ISO_DATE.test(start) || !ISO_DATE.test(end) || !ISO_DATE.test(today)) {
    return null;
  }
  if (end < start) return null;
  if (today <= start) return 0;
  if (today >= end) return 100;
  const span = utcDay(end) - utcDay(start);
  if (span <= 0) return 100;
  return Math.round(((utcDay(today) - utcDay(start)) / span) * 100);
}

/** Behind the straight-line plan, or still short after the end date. */
export type DeliveryLag = 'behind' | 'overdue';

export function deliveryLag(input: {
  actual: number | null;
  target: number | null;
  status?: string;
}): DeliveryLag | null {
  if (input.status === 'cancelled' || input.target == null) return null;
  if (input.actual == null && input.status === 'done') return null;
  const actual = input.actual ?? 0;
  if (actual >= input.target) return null;
  if (input.target >= 100) return 'overdue';
  return 'behind';
}

export function deliveryPaceClass(lag: DeliveryLag | null): string | undefined {
  if (lag === 'overdue') return 'kh-ops-pace-overdue';
  if (lag === 'behind') return 'kh-ops-pace-behind';
  return undefined;
}

/**
 * Story and epic percents from child tasks and bugs.
 * Each child contributes its completion step. Cancelled children are left out.
 * A parent with none left is omitted.
 */
export function deliveryCompletionIndex(
  tasks: readonly DeliveryCompletionTask[],
): DeliveryCompletionIndex {
  const stories = new Map<string, Bucket>();
  const epics = new Map<string, Bucket>();
  for (const task of tasks) {
    const points = taskCompletionPoints(task.status, task.completionPercent);
    bump(stories, task.userStoryId, points);
    bump(epics, task.epicId, points);
  }
  const byStoryId = new Map<string, DeliveryCompletion>();
  const byEpicId = new Map<string, DeliveryCompletion>();
  for (const [id, bucket] of stories) byStoryId.set(id, toCompletion(bucket));
  for (const [id, bucket] of epics) byEpicId.set(id, toCompletion(bucket));
  return { byStoryId, byEpicId };
}
