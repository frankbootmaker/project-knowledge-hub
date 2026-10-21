import {
  roundAiMoney,
  splitAiMoney,
  summarizeAiBillingMonth,
  type AiBillingMonthSummary,
} from './ai-billing.js';

export const AI_COST_GRAINS = ['month', 'week', 'day'] as const;

export type AiCostGrain = (typeof AI_COST_GRAINS)[number];

/** Day bars past this span switch to weeks so the axis stays readable. */
export const AI_COST_DAY_LIMIT = 92;

export type AiCostDayAmount = {
  date: string;
  currency: string;
  subscription: number;
  planChange: number;
  onDemand: number;
  theoreticalApiCost: number;
};

export type AiCostBucket = AiBillingMonthSummary & { scheduled: boolean };

const DAY = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function isIsoDay(value: string): boolean {
  const match = DAY.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function isIsoMonth(value: string): boolean {
  return MONTH.test(value);
}

export function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

export function addCalendarDays(iso: string, days: number): string {
  const match = DAY.exec(iso);
  if (!match) return iso;
  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days),
  );
  return date.toISOString().slice(0, 10);
}

export function lastDayOfMonth(period: string): string {
  const match = MONTH.exec(period);
  if (!match) return period;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]), 0));
  return date.toISOString().slice(0, 10);
}

export function firstDayOfMonth(period: string): string {
  return isIsoMonth(period) ? `${period}-01` : period;
}

/** Inclusive day list. Empty when the end is before the start. */
export function listCalendarDays(fromDay: string, toDay: string): string[] {
  if (!isIsoDay(fromDay) || !isIsoDay(toDay) || fromDay > toDay) return [];
  const days: string[] = [];
  let cursor = fromDay;
  while (cursor <= toDay && days.length < 8000) {
    days.push(cursor);
    cursor = addCalendarDays(cursor, 1);
  }
  return days;
}

/** Monday of the ISO week that contains `iso`. */
export function weekStartMonday(iso: string): string {
  const match = DAY.exec(iso);
  if (!match) return iso;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  const weekday = date.getUTCDay();
  const delta = weekday === 0 ? -6 : 1 - weekday;
  return addCalendarDays(iso, delta);
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Calendar year/month/day in an IANA zone. Invalid zones use UTC. */
export function zonedCalendarParts(
  now: Date,
  timeZone?: string | null,
): { year: number; month: number; day: number } {
  const zone = timeZone && isValidTimeZone(timeZone) ? timeZone : 'UTC';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: read('year'), month: read('month'), day: read('day') };
}

export function calendarQuarterWindow(
  year: number,
  month: number,
): { from: string; to: string; fromDay: string; toDay: string } {
  const startMonth = Math.floor((month - 1) / 3) * 3 + 1;
  const endMonth = startMonth + 2;
  const from = `${year}-${pad2(startMonth)}`;
  const to = `${year}-${pad2(endMonth)}`;
  return { from, to, fromDay: `${from}-01`, toDay: lastDayOfMonth(to) };
}

export function calendarMonthWindow(
  year: number,
  month: number,
): { from: string; to: string; fromDay: string; toDay: string } {
  const period = `${year}-${pad2(month)}`;
  return {
    from: period,
    to: period,
    fromDay: `${period}-01`,
    toDay: lastDayOfMonth(period),
  };
}

export function isAiCostGrain(value: string): value is AiCostGrain {
  return (AI_COST_GRAINS as readonly string[]).includes(value);
}

/**
 * Day view wider than {@link AI_COST_DAY_LIMIT} becomes weeks.
 * The caller shows that the switch happened.
 */
export function resolveAiCostGrain(
  requested: string | null | undefined,
  fromDay: string,
  toDay: string,
): { grain: AiCostGrain; adjusted: boolean } {
  const grain = requested && isAiCostGrain(requested) ? requested : 'month';
  if (grain !== 'day') return { grain, adjusted: false };
  const count = listCalendarDays(fromDay, toDay).length;
  if (count > AI_COST_DAY_LIMIT) return { grain: 'week', adjusted: true };
  return { grain: 'day', adjusted: false };
}

export type BillingDaySlice = { date: string; amount: number };

/**
 * Spread one paid entry evenly across its service days (start inclusive,
 * end exclusive). Cents use the largest remainder, so the days sum to the
 * entry. 6 Oct–6 Nov is 31 days at 200/31. A row without dates is spread
 * across the days of `period`, so a daily total still matches that month.
 */
export function splitBillingEntryByDay(entry: {
  amount: number;
  period: string;
  servicePeriodStart?: string | null;
  servicePeriodEnd?: string | null;
}): BillingDaySlice[] {
  const start = entry.servicePeriodStart?.trim() ?? '';
  const end = entry.servicePeriodEnd?.trim() ?? '';
  let dates: string[] = [];
  if (isIsoDay(start) && isIsoDay(end) && end > start) {
    dates = listCalendarDays(start, addCalendarDays(end, -1));
  } else if (isIsoMonth(entry.period)) {
    dates = listCalendarDays(`${entry.period}-01`, lastDayOfMonth(entry.period));
  }
  if (dates.length === 0) return [];
  const amounts = splitAiMoney(entry.amount, dates.map(() => 1));
  return dates.map((date, index) => ({ date, amount: amounts[index] ?? 0 }));
}

type PaidEntry = {
  amount: number;
  currency: string;
  type: string;
  period: string;
  servicePeriodStart?: string | null;
  servicePeriodEnd?: string | null;
};

/** One currency's paid amount on each service day. */
export function paidDaysFromBillingEntries(entries: readonly PaidEntry[]): AiCostDayAmount[] {
  const buckets = new Map<string, AiCostDayAmount>();
  for (const entry of entries) {
    if (
      entry.type !== 'subscription' &&
      entry.type !== 'plan_change' &&
      entry.type !== 'on_demand'
    ) {
      continue;
    }
    for (const slice of splitBillingEntryByDay(entry)) {
      const key = `${slice.date}|${entry.currency}`;
      const current = buckets.get(key) ?? {
        date: slice.date,
        currency: entry.currency,
        subscription: 0,
        planChange: 0,
        onDemand: 0,
        theoreticalApiCost: 0,
      };
      if (entry.type === 'subscription') current.subscription += slice.amount;
      else if (entry.type === 'plan_change') current.planChange += slice.amount;
      else current.onDemand += slice.amount;
      buckets.set(key, current);
    }
  }
  return [...buckets.values()].map((row) => ({
    ...row,
    subscription: roundAiMoney(row.subscription),
    planChange: roundAiMoney(row.planChange),
    onDemand: roundAiMoney(row.onDemand),
  }));
}

function bucketKey(date: string, grain: AiCostGrain): string {
  if (grain === 'month') return date.slice(0, 7);
  if (grain === 'week') return weekStartMonday(date);
  return date;
}

function bucketStart(key: string, grain: AiCostGrain): string {
  if (grain === 'month') return `${key}-01`;
  return key;
}

/**
 * Sum days into month, week, or day buckets. Weeks and months are sums of
 * the same days, so the three grains of one range match. Gap buckets inside
 * the covered span are zero. A bucket that starts after `today` is scheduled.
 * A future bucket with no paid amount is omitted (theoretical-only future
 * stays off the chart, matching the monthly view).
 */
export function aggregateAiCostBuckets(
  points: readonly AiCostDayAmount[],
  input: { grain: AiCostGrain; fromDay: string; toDay: string; today: string },
): AiCostBucket[] {
  const days = listCalendarDays(input.fromDay, input.toDay);
  if (days.length === 0) return [];
  const inRange = points.filter(
    (point) => point.date >= input.fromDay && point.date <= input.toDay,
  );
  const currencies = [...new Set(inRange.map((point) => point.currency))].sort((a, b) =>
    a.localeCompare(b),
  );
  const rows: AiCostBucket[] = [];
  for (const currency of currencies) {
    const mine = inRange.filter((point) => point.currency === currency);
    const byKey = new Map<
      string,
      { subscription: number; planChange: number; onDemand: number; theoreticalApiCost: number }
    >();
    for (const point of mine) {
      const key = bucketKey(point.date, input.grain);
      const current = byKey.get(key) ?? {
        subscription: 0,
        planChange: 0,
        onDemand: 0,
        theoreticalApiCost: 0,
      };
      current.subscription += point.subscription;
      current.planChange += point.planChange;
      current.onDemand += point.onDemand;
      current.theoreticalApiCost += point.theoreticalApiCost;
      byKey.set(key, current);
    }
    const keys = [
      ...new Set(days.map((day) => bucketKey(day, input.grain))),
    ].sort((a, b) => a.localeCompare(b));
    const paidOn = (key: string) => {
      const row = byKey.get(key);
      if (!row) return false;
      return row.subscription !== 0 || row.planChange !== 0 || row.onDemand !== 0;
    };
    const anchors = keys.filter((key) => {
      const start = bucketStart(key, input.grain);
      if (start <= input.today) return byKey.has(key);
      return paidOn(key);
    });
    if (anchors.length === 0) continue;
    const firstAnchor = anchors[0];
    const last = anchors[anchors.length - 1];
    const rangeStart = keys[0];
    if (!firstAnchor || !last || !rangeStart) continue;
    const first = rangeStart <= input.today ? rangeStart : firstAnchor;
    for (const key of keys) {
      if (key < first || key > last) continue;
      const start = bucketStart(key, input.grain);
      const future = start > input.today;
      const row = byKey.get(key);
      rows.push({
        ...summarizeAiBillingMonth({
          period: key,
          currency,
          subscription: row?.subscription ?? 0,
          planChange: row?.planChange ?? 0,
          onDemand: row?.onDemand ?? 0,
          theoreticalApiCost: row?.theoreticalApiCost ?? 0,
        }),
        scheduled: future,
      });
    }
  }
  return rows;
}

const LOCALE_TAGS: Record<string, string> = {
  en: 'en-US',
  de: 'de-DE',
  hu: 'hu-HU',
};

/** "Oct 19" / "19. Okt." / "okt. 19." for a day or week-start label. */
export function formatAiCostDayLabel(iso: string, locale: string): string {
  const match = DAY.exec(iso);
  if (!match) return iso;
  const tag = LOCALE_TAGS[locale.toLowerCase()] ?? locale;
  return new Intl.DateTimeFormat(tag, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))));
}
