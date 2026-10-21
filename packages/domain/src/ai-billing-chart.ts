import {
  assertAiBillingPeriod,
  currentAiBillingPeriod,
  listAiBillingPeriods,
  resolveAiBillingWindow,
  shiftAiBillingPeriod,
  splitBillingEntryByMonth,
  summarizeAiBillingMonth,
  type AiBillingMonthSummary,
} from './ai-billing.js';
import {
  calendarMonthWindow,
  calendarQuarterWindow,
  firstDayOfMonth,
  isIsoDay,
  isIsoMonth,
  lastDayOfMonth,
  zonedCalendarParts,
} from './ai-cost-granularity.js';

export const AI_COST_RANGES = ['last12', 'year', 'quarter', 'month', 'all'] as const;

export type AiCostRange = (typeof AI_COST_RANGES)[number];

export type AiCostViewRange = AiCostRange | 'custom';

export type AiCostChartSourcePoint = {
  period: string;
  currency: string;
  subscription: number;
  planChange: number;
  onDemand: number;
  theoreticalApiCost: number;
  fxRate?: number | null;
  fxRateDate?: string | null;
  fxSource?: string | null;
};

export type AiCostCoverageEntry = {
  amount: number;
  period: string;
  currency: string;
  servicePeriodStart?: string | null;
  servicePeriodEnd?: string | null;
};

export type AiCostChartMonth = AiBillingMonthSummary & {
  scheduled: boolean;
  fxRate: number | null;
  fxRateDate: string | null;
  fxSource: string | null;
};

const LOCALE_TAGS: Record<string, string> = {
  en: 'en-US',
  de: 'de-DE',
  hu: 'hu-HU',
};

/**
 * Month label for charts, tooltips, and the monthly overview.
 * English "Oct 2026", German "Okt. 2026", Hungarian "2026. okt.".
 */
export function formatAiBillingMonthLabel(period: string, locale: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(period.trim());
  if (!match) return period;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const tag = LOCALE_TAGS[locale.toLowerCase()] ?? locale;
  return new Intl.DateTimeFormat(tag, {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

export function periodsCoveredByEntry(entry: {
  amount: number;
  period: string;
  servicePeriodStart?: string | null;
  servicePeriodEnd?: string | null;
}): string[] {
  return splitBillingEntryByMonth({
    amount: entry.amount,
    period: entry.period,
    servicePeriodStart: entry.servicePeriodStart,
    servicePeriodEnd: entry.servicePeriodEnd,
  }).map((slice) => slice.period);
}

function isAiCostRange(value: string): value is AiCostRange {
  return (AI_COST_RANGES as readonly string[]).includes(value);
}

export type AiCostResolvedWindow = {
  /** First month the window touches, YYYY-MM. */
  from: string;
  /** Last month the window touches, YYYY-MM. */
  to: string;
  /** Inclusive first day. Presets use the month edges in the user's zone. */
  fromDay: string;
  /** Inclusive last day. */
  toDay: string;
  range: AiCostViewRange;
};

function monthBound(value: string): string | null {
  if (isIsoMonth(value)) return value;
  if (isIsoDay(value)) return value.slice(0, 7);
  return null;
}

function withDays(
  window: { from: string; to: string; range: AiCostViewRange },
  fromDay?: string | null,
  toDay?: string | null,
): AiCostResolvedWindow {
  return {
    ...window,
    fromDay: fromDay && isIsoDay(fromDay) ? fromDay : firstDayOfMonth(window.from),
    toDay: toDay && isIsoDay(toDay) ? toDay : lastDayOfMonth(window.to),
  };
}

/**
 * Shared window for the workspace and platform AI Cost pages.
 * Explicit from/to wins (YYYY-MM or YYYY-MM-DD). Otherwise last 12 months,
 * this calendar year, this quarter, this month, or every month that already
 * has data. Quarter and month use the calendar in `timeZone` (UTC when the
 * zone is missing or invalid).
 */
export function resolveAiCostViewWindow(
  input: {
    from?: string | null;
    to?: string | null;
    range?: string | null;
    knownPeriods?: readonly string[];
    timeZone?: string | null;
  },
  now = new Date(),
): AiCostResolvedWindow {
  const fromRaw = input.from?.trim() ?? '';
  const toRaw = input.to?.trim() ?? '';
  const fromMonth = monthBound(fromRaw);
  const toMonth = monthBound(toRaw);
  if (fromMonth || toMonth) {
    const window = resolveAiBillingWindow(
      { from: fromMonth, to: toMonth },
      now,
    );
    const fromDay = isIsoDay(fromRaw) ? fromRaw : firstDayOfMonth(window.from);
    const toDay = isIsoDay(toRaw) ? toRaw : lastDayOfMonth(window.to);
    return withDays({ ...window, range: 'custom' }, fromDay, toDay);
  }
  const range = input.range?.trim() ?? '';
  const zoned = zonedCalendarParts(now, input.timeZone);
  if (range === 'year') {
    const year = String(zoned.year);
    return withDays({ from: `${year}-01`, to: `${year}-12`, range: 'year' });
  }
  if (range === 'quarter') {
    const quarter = calendarQuarterWindow(zoned.year, zoned.month);
    return { ...quarter, range: 'quarter' };
  }
  if (range === 'month') {
    const month = calendarMonthWindow(zoned.year, zoned.month);
    return { ...month, range: 'month' };
  }
  if (range === 'all') {
    const known = [...(input.knownPeriods ?? [])]
      .filter((period) => /^\d{4}-(0[1-9]|1[0-2])$/.test(period))
      .sort((a, b) => a.localeCompare(b));
    const current = currentAiBillingPeriod(now);
    if (known.length === 0) {
      return withDays({ from: current, to: current, range: 'all' });
    }
    const earliest = known[0] ?? current;
    const latest = known[known.length - 1] ?? current;
    return withDays({
      from: earliest,
      to: latest > current ? latest : current,
      range: 'all',
    });
  }
  const zonedPeriod = `${zoned.year}-${String(zoned.month).padStart(2, '0')}`;
  const to = range === 'last12' || !isAiCostRange(range) ? zonedPeriod : currentAiBillingPeriod(now);
  const window = {
    from: shiftAiBillingPeriod(to, -11),
    to,
  };
  return withDays({
    ...window,
    range: isAiCostRange(range) ? range : 'last12',
  });
}

function pointKey(period: string, currency: string): string {
  return `${period}|${currency}`;
}

function paidActivity(point: Pick<
  AiCostChartSourcePoint,
  'subscription' | 'planChange' | 'onDemand'
>): boolean {
  return point.subscription !== 0 || point.planChange !== 0 || point.onDemand !== 0;
}

/**
 * Months inside the window, with gaps as zero. A month after the current
 * UTC month is included only when a paid entry covers it, and is marked
 * scheduled. Currencies with nothing in the window are omitted.
 */
export function fillAiCostChart(
  input: {
    points: readonly AiCostChartSourcePoint[];
    entries?: readonly AiCostCoverageEntry[];
    from: string;
    to: string;
  },
  now = new Date(),
): AiCostChartMonth[] {
  const from = assertAiBillingPeriod(input.from);
  const to = assertAiBillingPeriod(input.to);
  if (from > to) return [];
  const current = currentAiBillingPeriod(now);
  const periods = listAiBillingPeriods(from, to);
  const periodSet = new Set(periods);
  const covered = new Map<string, Set<string>>();
  const ensure = (currency: string) => {
    const set = covered.get(currency) ?? new Set<string>();
    covered.set(currency, set);
    return set;
  };
  for (const point of input.points) {
    if (paidActivity(point)) ensure(point.currency).add(point.period);
  }
  for (const entry of input.entries ?? []) {
    const set = ensure(entry.currency);
    for (const period of periodsCoveredByEntry(entry)) set.add(period);
  }

  const currencies = new Set<string>([
    ...input.points.map((point) => point.currency),
    ...(input.entries ?? []).map((entry) => entry.currency),
  ]);
  const byKey = new Map(
    input.points.map((point) => [pointKey(point.period, point.currency), point]),
  );
  const rows: AiCostChartMonth[] = [];
  for (const currency of [...currencies].sort((a, b) => a.localeCompare(b))) {
    const cover = covered.get(currency) ?? new Set<string>();
    const active = [...periodSet].some(
      (period) => byKey.has(pointKey(period, currency)) || cover.has(period),
    );
    if (!active) continue;
    for (const period of periods) {
      const future = period > current;
      if (future && !cover.has(period)) continue;
      const point = byKey.get(pointKey(period, currency));
      rows.push({
        ...summarizeAiBillingMonth({
          period,
          currency,
          subscription: point?.subscription ?? 0,
          planChange: point?.planChange ?? 0,
          onDemand: point?.onDemand ?? 0,
          theoreticalApiCost: point?.theoreticalApiCost ?? 0,
        }),
        scheduled: future,
        fxRate: point?.fxRate ?? null,
        fxRateDate: point?.fxRateDate ?? null,
        fxSource: point?.fxSource ?? null,
      });
    }
  }
  return rows;
}

export type PlatformAiCostMonthRow = AiBillingMonthSummary & {
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
  scheduled?: boolean;
};

/**
 * Insert gap months into a platform report and rebuild currency totals from
 * those rows. Future months stay only when an entry covers them.
 */
export function fillPlatformAiCostMonths<T extends PlatformAiCostMonthRow>(
  input: {
    from: string;
    to: string;
    months: readonly T[];
    entries: readonly (AiCostCoverageEntry & {
      workspaceId: string;
      workspaceName?: string;
      workspaceSlug?: string;
    })[];
  },
  now = new Date(),
): {
  months: Array<T & { scheduled: boolean }>;
  totals: Array<AiBillingMonthSummary & { scheduled: boolean }>;
} {
  const meta = new Map<
    string,
    { workspaceId: string; workspaceName: string; workspaceSlug: string }
  >();
  for (const month of input.months) {
    meta.set(month.workspaceId, {
      workspaceId: month.workspaceId,
      workspaceName: month.workspaceName,
      workspaceSlug: month.workspaceSlug,
    });
  }
  for (const entry of input.entries) {
    if (meta.has(entry.workspaceId)) continue;
    meta.set(entry.workspaceId, {
      workspaceId: entry.workspaceId,
      workspaceName: entry.workspaceName ?? entry.workspaceId,
      workspaceSlug: entry.workspaceSlug ?? '',
    });
  }

  const months: Array<T & { scheduled: boolean }> = [];
  for (const workspace of meta.values()) {
    const points = input.months
      .filter((month) => month.workspaceId === workspace.workspaceId)
      .map((month) => ({
        period: month.period,
        currency: month.currency,
        subscription: month.subscription,
        planChange: month.planChange,
        onDemand: month.onDemand,
        theoreticalApiCost: month.theoreticalApiCost,
      }));
    const entries = input.entries.filter(
      (entry) => entry.workspaceId === workspace.workspaceId,
    );
    const filled = fillAiCostChart(
      { points, entries, from: input.from, to: input.to },
      now,
    );
    for (const row of filled) {
      const existing = input.months.find(
        (month) =>
          month.workspaceId === workspace.workspaceId &&
          month.period === row.period &&
          month.currency === row.currency,
      );
      months.push({
        ...(existing ?? ({} as T)),
        ...workspace,
        ...row,
      });
    }
  }
  months.sort((a, b) => {
    const period = b.period.localeCompare(a.period);
    if (period !== 0) return period;
    const currency = a.currency.localeCompare(b.currency);
    if (currency !== 0) return currency;
    return (
      a.workspaceName.localeCompare(b.workspaceName) ||
      a.workspaceId.localeCompare(b.workspaceId)
    );
  });

  const grouped = new Map<string, AiBillingMonthSummary>();
  for (const month of months) {
    const key = pointKey(month.period, month.currency);
    const current = grouped.get(key) ?? {
      period: month.period,
      currency: month.currency,
      subscription: 0,
      planChange: 0,
      onDemand: 0,
      theoreticalApiCost: 0,
      paidCost: 0,
      difference: 0,
      ratio: null,
    };
    current.subscription += month.subscription;
    current.planChange += month.planChange;
    current.onDemand += month.onDemand;
    current.theoreticalApiCost += month.theoreticalApiCost;
    grouped.set(key, current);
  }
  const current = currentAiBillingPeriod(now);
  const totals = [...grouped.values()]
    .map((row) => ({
      ...summarizeAiBillingMonth(row),
      scheduled: row.period > current,
    }))
    .sort(
      (a, b) => a.currency.localeCompare(b.currency) || b.period.localeCompare(a.period),
    );
  return { months, totals };
}
