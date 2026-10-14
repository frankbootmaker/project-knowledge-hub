/**
 * Derived delivery completion.
 *
 * The stored task step and the story/epic rollup live in
 * `@project-knowledge-hub/domain`. This module adds the schedule helpers
 * the delivery screens use beside that percent.
 *
 * Status wins over the calculated value: Done is 100, Cancelled is 0.
 * A parent average leaves cancelled children out. Counting them as 0 would
 * make a finished story look incomplete after someone cancels a leftover task.
 */

export {
  averageCompletion,
  childCompletionPoints as taskCompletionPoints,
  deliveryCompletionIndex,
  displayedParentCompletion,
  displayedTaskCompletionPercent,
  type DeliveryCompletionChild as DeliveryCompletionTask,
  type DeliveryCompletionRollup as DeliveryCompletion,
} from '@project-knowledge-hub/domain';

import {
  displayedTaskCompletionPercent,
  type DeliveryCompletionRollup,
} from '@project-knowledge-hub/domain';

export type DeliveryCompletionIndex = {
  byStoryId: Map<string, DeliveryCompletionRollup>;
  byEpicId: Map<string, DeliveryCompletionRollup>;
};

/** What a task row shows. Done is 100. Cancelled is 0. Otherwise the stored step. */
export function taskDeliveryCompletion(
  status: string,
  completionPercent?: number | null,
): DeliveryCompletionRollup {
  const percent = displayedTaskCompletionPercent(status, completionPercent);
  return { percent, done: percent / 100, total: 1 };
}

/** Local calendar day as YYYY-MM-DD. */
export function localDateIso(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** UTC calendar day. Stable across the server and the first client paint. */
export function utcDateIso(now = new Date()): string {
  return now.toISOString().slice(0, 10);
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
 * Locale percent text with unicode spaces folded to a normal space.
 * Node and the browser disagree on NBSP vs narrow NBSP, which breaks hydration.
 */
export function formatPercentLabel(percent: number, locale: string): string {
  const formatted = new Intl.NumberFormat(locale, {
    style: 'percent',
    maximumFractionDigits: 0,
  }).format(percent / 100);
  return formatted.replace(/[\u00a0\u202f\u2009]/g, ' ');
}

/** Same space folding for counts such as "1.5". */
export function formatStableNumber(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 })
    .format(value)
    .replace(/[\u00a0\u202f\u2009]/g, ' ');
}
