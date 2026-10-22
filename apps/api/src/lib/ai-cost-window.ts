import {
  aggregateAiCostBuckets,
  currentAiBillingPeriod,
  fillAiCostChart,
  fillPlatformAiCostMonths,
  firstDayOfMonth,
  lastDayOfMonth,
  listAiBillingPeriods,
  paidDaysFromBillingEntries,
  periodsCoveredByEntry,
  resolveAiCostGrain,
  resolveAiCostViewWindow,
  roundAiMoney,
  shiftAiBillingPeriod,
  zonedCalendarParts,
  type AiCostBucket,
  type AiCostChartMonth,
  type AiCostDayAmount,
  type AiCostGrain,
  type AiCostResolvedWindow,
  type AiCostViewRange,
} from '@project-knowledge-hub/domain';
import type {
  PlatformAiCostReport,
  TheoreticalDayPoint,
  TheoreticalSplit,
  WorkspaceAiCostOverview,
} from './ai-billing.js';

export type AiCostWindowQuery = {
  from?: string;
  to?: string;
  range?: string;
  grain?: string;
  timeZone?: string;
};

type CoverageEntry = {
  amount: number;
  period: string;
  currency: string;
  servicePeriodStart?: string | null;
  servicePeriodEnd?: string | null;
};

type LedgerEntry = CoverageEntry & {
  type?: string;
  convertedAmount?: number;
  convertedCurrency?: string;
};

export type AiCostSeriesPoint = AiCostChartMonth | (AiCostBucket & {
  fxRate?: number | null;
  fxRateDate?: string | null;
  fxSource?: string | null;
});

export type TheoreticalMonthRow = {
  period: string;
  currency: string;
  linked: number;
  unassigned: number;
  total: number;
};

function reportingCoverage(entries: readonly LedgerEntry[]): CoverageEntry[] {
  return entries.map((entry) => ({
    amount: entry.convertedAmount ?? entry.amount,
    period: entry.period,
    currency: entry.convertedCurrency ?? entry.currency,
    servicePeriodStart: entry.servicePeriodStart,
    servicePeriodEnd: entry.servicePeriodEnd,
  }));
}

function originalCoverage(entries: readonly LedgerEntry[]): CoverageEntry[] {
  return entries.map((entry) => ({
    amount: entry.amount,
    period: entry.period,
    currency: entry.currency,
    servicePeriodStart: entry.servicePeriodStart,
    servicePeriodEnd: entry.servicePeriodEnd,
  }));
}

function coverageOf(entry: CoverageEntry): string[] {
  return periodsCoveredByEntry(entry);
}

function knownPeriods(
  points: ReadonlyArray<{ period: string; subscription: number; planChange: number; onDemand: number }>,
  entries: readonly CoverageEntry[],
  now: Date,
): string[] {
  const current = currentAiBillingPeriod(now);
  const known = new Set<string>();
  for (const entry of entries) {
    for (const period of coverageOf(entry)) known.add(period);
  }
  for (const point of points) {
    const paid =
      point.subscription !== 0 || point.planChange !== 0 || point.onDemand !== 0;
    if (point.period <= current || paid || known.has(point.period)) known.add(point.period);
  }
  return [...known];
}

function coversFullMonths(window: AiCostResolvedWindow): boolean {
  return (
    window.fromDay === firstDayOfMonth(window.from) &&
    window.toDay === lastDayOfMonth(window.to)
  );
}

function paidDayRows(entries: readonly LedgerEntry[], reporting: boolean): AiCostDayAmount[] {
  return paidDaysFromBillingEntries(
    entries.map((entry) => ({
      amount: reporting ? (entry.convertedAmount ?? entry.amount) : entry.amount,
      currency: reporting ? (entry.convertedCurrency ?? entry.currency) : entry.currency,
      type: entry.type ?? 'subscription',
      period: entry.period,
      servicePeriodStart: entry.servicePeriodStart,
      servicePeriodEnd: entry.servicePeriodEnd,
    })),
  );
}

function theoreticalDayRows(days: readonly TheoreticalDayPoint[]): AiCostDayAmount[] {
  const buckets = new Map<string, AiCostDayAmount>();
  for (const point of days) {
    if (point.amount === 0) continue;
    const key = `${point.date}|${point.currency}`;
    const current = buckets.get(key) ?? {
      date: point.date,
      currency: point.currency,
      subscription: 0,
      planChange: 0,
      onDemand: 0,
      theoreticalApiCost: 0,
    };
    current.theoreticalApiCost += point.amount;
    buckets.set(key, current);
  }
  return [...buckets.values()].map((row) => ({
    ...row,
    theoreticalApiCost: roundAiMoney(row.theoreticalApiCost),
  }));
}

function mergeDayAmounts(
  paid: readonly AiCostDayAmount[],
  theoretical: readonly AiCostDayAmount[],
): AiCostDayAmount[] {
  const buckets = new Map<string, AiCostDayAmount>();
  for (const point of [...paid, ...theoretical]) {
    const key = `${point.date}|${point.currency}`;
    const current = buckets.get(key) ?? {
      date: point.date,
      currency: point.currency,
      subscription: 0,
      planChange: 0,
      onDemand: 0,
      theoreticalApiCost: 0,
    };
    current.subscription += point.subscription;
    current.planChange += point.planChange;
    current.onDemand += point.onDemand;
    current.theoreticalApiCost += point.theoreticalApiCost;
    buckets.set(key, current);
  }
  return [...buckets.values()].map((row) => ({
    ...row,
    subscription: roundAiMoney(row.subscription),
    planChange: roundAiMoney(row.planChange),
    onDemand: roundAiMoney(row.onDemand),
    theoreticalApiCost: roundAiMoney(row.theoreticalApiCost),
  }));
}

function seriesFor(input: {
  grain: AiCostGrain;
  fullMonths: boolean;
  monthly: AiCostChartMonth[];
  days: readonly AiCostDayAmount[];
  fromDay: string;
  toDay: string;
  today: string;
}): AiCostSeriesPoint[] {
  if (input.grain === 'month' && input.fullMonths) return input.monthly;
  return aggregateAiCostBuckets(input.days, {
    grain: input.grain,
    fromDay: input.fromDay,
    toDay: input.toDay,
    today: input.today,
  });
}

function theoreticalMonths(
  days: readonly TheoreticalDayPoint[],
  fromDay: string,
  toDay: string,
): TheoreticalMonthRow[] {
  const buckets = new Map<string, TheoreticalMonthRow>();
  for (const point of days) {
    if (point.date < fromDay || point.date > toDay || point.amount === 0) continue;
    const period = point.date.slice(0, 7);
    const key = `${period}|${point.currency}`;
    const current = buckets.get(key) ?? {
      period,
      currency: point.currency,
      linked: 0,
      unassigned: 0,
      total: 0,
    };
    if (point.linked) current.linked += point.amount;
    else current.unassigned += point.amount;
    current.total += point.amount;
    buckets.set(key, current);
  }
  return [...buckets.values()]
    .map((row) => ({
      ...row,
      linked: roundAiMoney(row.linked),
      unassigned: roundAiMoney(row.unassigned),
      total: roundAiMoney(row.total),
    }))
    .sort((a, b) => a.period.localeCompare(b.period) || a.currency.localeCompare(b.currency));
}

function theoreticalSplit(
  days: readonly TheoreticalDayPoint[],
  fromDay: string,
  toDay: string,
): TheoreticalSplit[] {
  const buckets = new Map<string, TheoreticalSplit>();
  for (const point of days) {
    if (point.date < fromDay || point.date > toDay || point.amount === 0) continue;
    const current = buckets.get(point.currency) ?? {
      currency: point.currency,
      linked: 0,
      unassigned: 0,
      total: 0,
      projects: [],
    };
    if (point.linked) current.linked += point.amount;
    else current.unassigned += point.amount;
    current.total += point.amount;
    if (point.linked && point.projectId) {
      const project = current.projects.find((row) => row.projectId === point.projectId);
      if (project) project.amount += point.amount;
      else {
        current.projects.push({
          projectId: point.projectId,
          name: point.projectName ?? point.projectId,
          amount: point.amount,
        });
      }
    }
    buckets.set(point.currency, current);
  }
  return [...buckets.values()]
    .map((row) => ({
      ...row,
      linked: roundAiMoney(row.linked),
      unassigned: roundAiMoney(row.unassigned),
      total: roundAiMoney(row.total),
      projects: row.projects
        .map((project) => ({ ...project, amount: roundAiMoney(project.amount) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

export type PresentedWorkspaceAiCost = Omit<
  WorkspaceAiCostOverview,
  'chart' | 'originalChart' | 'theoreticalDays' | 'originalTheoreticalDays'
> & {
  chart: AiCostSeriesPoint[];
  originalChart: AiCostSeriesPoint[];
  /** Calendar months. A partial day range clips each month to the selected days. */
  monthly: AiCostSeriesPoint[];
  originalMonthly: AiCostSeriesPoint[];
  from: string;
  to: string;
  fromDay: string;
  toDay: string;
  range: AiCostViewRange;
  grain: AiCostGrain;
  grainAdjusted: boolean;
  theoretical: TheoreticalSplit[];
  theoreticalMonths: TheoreticalMonthRow[];
};

/**
 * Chart grain follows the query. A full-month window on the month grain
 * keeps the monthly ledger (so day-proration rounding stays off the default
 * view). Any other grain, and a month grain of a partial day range, sums the
 * same daily slices, so day, week, and that month total match.
 * The monthly table stays calendar months, clipped to the selected days when
 * the window is not a whole month.
 */
export function presentWorkspaceAiCost(
  overview: WorkspaceAiCostOverview,
  query: AiCostWindowQuery,
  now = new Date(),
): PresentedWorkspaceAiCost {
  const reportingEntries = reportingCoverage(overview.entries);
  const originalEntries = originalCoverage(overview.entries);
  const window = resolveAiCostViewWindow(
    {
      from: query.from,
      to: query.to,
      range: query.range,
      timeZone: query.timeZone,
      knownPeriods: knownPeriods(
        [...overview.chart, ...overview.originalChart],
        [...reportingEntries, ...originalEntries],
        now,
      ),
    },
    now,
  );
  const grain = resolveAiCostGrain(query.grain, window.fromDay, window.toDay);
  const fullMonths = coversFullMonths(window);
  const today = now.toISOString().slice(0, 10);
  const monthly = fillAiCostChart(
    {
      points: overview.chart,
      entries: reportingEntries,
      from: window.from,
      to: window.to,
    },
    now,
  );
  const originalMonthlyFilled = fillAiCostChart(
    {
      points: overview.originalChart,
      entries: originalEntries,
      from: window.from,
      to: window.to,
    },
    now,
  );
  const reportingDays = mergeDayAmounts(
    paidDayRows(overview.entries, true),
    theoreticalDayRows(overview.theoreticalDays),
  );
  const originalDays = mergeDayAmounts(
    paidDayRows(overview.entries, false),
    theoreticalDayRows(overview.originalTheoreticalDays),
  );
  const clip = {
    fromDay: window.fromDay,
    toDay: window.toDay,
    today,
  };
  const tableMonthly = fullMonths
    ? monthly
    : aggregateAiCostBuckets(reportingDays, { grain: 'month', ...clip });
  const tableOriginal = fullMonths
    ? originalMonthlyFilled
    : aggregateAiCostBuckets(originalDays, { grain: 'month', ...clip });
  const {
    theoreticalDays,
    originalTheoreticalDays: _originalTheoreticalDays,
    chart: _chart,
    originalChart: _original,
    pools,
    ...rest
  } = overview;
  const zoned = zonedCalendarParts(now, query.timeZone);
  const currentPeriod = `${zoned.year}-${String(zoned.month).padStart(2, '0')}`;
  const visiblePools = pools
    .filter((pool) => pool.period >= window.from && pool.period <= window.to)
    .map((pool) => ({
      ...pool,
      scheduled: pool.period > currentPeriod,
    }));
  return {
    ...rest,
    pools: visiblePools,
    from: window.from,
    to: window.to,
    fromDay: window.fromDay,
    toDay: window.toDay,
    range: window.range,
    grain: grain.grain,
    grainAdjusted: grain.adjusted,
    chart: seriesFor({
      grain: grain.grain,
      fullMonths,
      monthly,
      days: reportingDays,
      ...clip,
    }),
    originalChart: seriesFor({
      grain: grain.grain,
      fullMonths,
      monthly: originalMonthlyFilled,
      days: originalDays,
      ...clip,
    }),
    monthly: tableMonthly,
    originalMonthly: tableOriginal,
    theoretical: theoreticalSplit(theoreticalDays, window.fromDay, window.toDay),
    theoreticalMonths: theoreticalMonths(theoreticalDays, window.fromDay, window.toDay),
  };
}

/**
 * Bounds passed to the platform loader. "All" uses a wide fetch so the
 * tight window can be derived from the rows that come back.
 * Quarter and month use the calendar in the caller's time zone.
 */
export function platformAiCostFetchWindow(
  query: AiCostWindowQuery,
  now = new Date(),
): { from?: string; to?: string; range: AiCostViewRange; discoverAll: boolean } {
  const from = query.from?.trim() ?? '';
  const to = query.to?.trim() ?? '';
  if (from || to) {
    const window = resolveAiCostViewWindow({ from, to, timeZone: query.timeZone }, now);
    return { from: window.from, to: window.to, range: 'custom', discoverAll: false };
  }
  if (query.range === 'year' || query.range === 'quarter' || query.range === 'month') {
    const window = resolveAiCostViewWindow(
      { range: query.range, timeZone: query.timeZone },
      now,
    );
    return { from: window.from, to: window.to, range: query.range, discoverAll: false };
  }
  if (query.range === 'all') {
    const current = currentAiBillingPeriod(now);
    return {
      from: shiftAiBillingPeriod(current, -240),
      to: shiftAiBillingPeriod(current, 36),
      range: 'all',
      discoverAll: true,
    };
  }
  const window = resolveAiCostViewWindow(
    { range: 'last12', timeZone: query.timeZone },
    now,
  );
  return { from: window.from, to: window.to, range: 'last12', discoverAll: false };
}

export type PresentedPlatformAiCost = Omit<
  PlatformAiCostReport,
  'theoreticalDays' | 'originalTheoreticalDays'
> & {
  range: AiCostViewRange;
  fromDay: string;
  toDay: string;
  grain: AiCostGrain;
  grainAdjusted: boolean;
  chart: AiCostSeriesPoint[];
  originalChart: AiCostSeriesPoint[];
  theoretical: TheoreticalSplit[];
  theoreticalMonths: TheoreticalMonthRow[];
};

export function presentPlatformAiCost(
  report: PlatformAiCostReport,
  query: AiCostWindowQuery,
  now = new Date(),
): PresentedPlatformAiCost {
  const fetch = platformAiCostFetchWindow(query, now);
  const ledger = report.entries as Array<
    (typeof report.entries)[number] & {
      convertedAmount?: number;
      convertedCurrency?: string;
      type: string;
    }
  >;
  const reportingEntries = ledger.map((entry) => ({
    ...reportingCoverage([entry])[0]!,
    type: entry.type,
    workspaceId: entry.workspaceId,
    workspaceName: entry.workspaceName,
    workspaceSlug: entry.workspaceSlug,
  }));
  const originalEntries = ledger.map((entry) => ({
    ...originalCoverage([entry])[0]!,
    type: entry.type,
    workspaceId: entry.workspaceId,
    workspaceName: entry.workspaceName,
    workspaceSlug: entry.workspaceSlug,
  }));
  const window = fetch.discoverAll
    ? resolveAiCostViewWindow(
        {
          range: 'all',
          timeZone: query.timeZone,
          knownPeriods: knownPeriods(
            [...report.months, ...report.originalMonths],
            [...reportingEntries, ...originalEntries],
            now,
          ),
        },
        now,
      )
    : resolveAiCostViewWindow(
        {
          from: query.from,
          to: query.to,
          range: fetch.range === 'custom' ? undefined : fetch.range,
          timeZone: query.timeZone,
        },
        now,
      );
  const filled = fillPlatformAiCostMonths(
    {
      from: window.from,
      to: window.to,
      months: report.months,
      entries: reportingEntries,
    },
    now,
  );
  const originalFilled = fillPlatformAiCostMonths(
    {
      from: window.from,
      to: window.to,
      months: report.originalMonths,
      entries: originalEntries,
    },
    now,
  );
  const grain = resolveAiCostGrain(query.grain, window.fromDay, window.toDay);
  const fullMonths = coversFullMonths(window);
  const today = now.toISOString().slice(0, 10);
  const clip = { fromDay: window.fromDay, toDay: window.toDay, today };
  const reportingTotals = totalsWithFx(filled.totals, filled.months, report.totals);
  const originalTotals = totalsWithFx(
    originalFilled.totals,
    originalFilled.months,
    report.originalTotals,
  );
  const chart = seriesFor({
    grain: grain.grain,
    fullMonths,
    monthly: reportingTotals,
    days: mergeDayAmounts(
      paidDayRows(ledger, true),
      theoreticalDayRows(report.theoreticalDays),
    ),
    ...clip,
  });
  const originalChart = seriesFor({
    grain: grain.grain,
    fullMonths,
    monthly: originalTotals,
    days: mergeDayAmounts(
      paidDayRows(ledger, false),
      theoreticalDayRows(report.originalTheoreticalDays),
    ),
    ...clip,
  });
  const {
    theoreticalDays,
    originalTheoreticalDays: _originalPlatformDays,
    ...rest
  } = report;
  return {
    ...rest,
    from: window.from,
    to: window.to,
    fromDay: window.fromDay,
    toDay: window.toDay,
    range: window.range,
    grain: grain.grain,
    grainAdjusted: grain.adjusted,
    periods: listAiBillingPeriods(window.from, window.to),
    months: filled.months,
    totals: reportingTotals,
    originalMonths: originalFilled.months,
    originalTotals,
    chart,
    originalChart,
    theoretical: theoreticalSplit(theoreticalDays, window.fromDay, window.toDay),
    theoreticalMonths: theoreticalMonths(theoreticalDays, window.fromDay, window.toDay),
  };
}

function totalsWithFx<
  T extends {
    period: string;
    currency: string;
    fxRate?: number | null;
    fxRateDate?: string | null;
    fxSource?: string | null;
  },
>(
  totals: ReadonlyArray<{
    period: string;
    currency: string;
    subscription: number;
    planChange: number;
    onDemand: number;
    theoreticalApiCost: number;
    paidCost: number;
    difference: number;
    ratio: number | null;
    scheduled: boolean;
  }>,
  months: readonly T[],
  prior: readonly T[],
): Array<{
  period: string;
  currency: string;
  subscription: number;
  planChange: number;
  onDemand: number;
  theoreticalApiCost: number;
  paidCost: number;
  difference: number;
  ratio: number | null;
  scheduled: boolean;
  fxRate: number | null;
  fxRateDate: string | null;
  fxSource: string | null;
}> {
  return totals.map((total) => {
    const previous = prior.find(
      (row) => row.period === total.period && row.currency === total.currency,
    );
    if (previous?.fxSource) {
      return {
        ...total,
        fxRate: previous.fxRate ?? null,
        fxRateDate: previous.fxRateDate ?? null,
        fxSource: previous.fxSource ?? null,
      };
    }
    const rows = months.filter(
      (month) =>
        month.period === total.period &&
        month.currency === total.currency &&
        month.fxSource,
    );
    const source = rows[0]?.fxSource ?? null;
    const same =
      rows.length > 0 &&
      rows.every(
        (month) =>
          month.fxSource === source &&
          month.fxRate === rows[0]?.fxRate &&
          month.fxRateDate === rows[0]?.fxRateDate,
      );
    return {
      ...total,
      fxRate: same ? (rows[0]?.fxRate ?? null) : null,
      fxRateDate: same ? (rows[0]?.fxRateDate ?? null) : null,
      fxSource: same ? source : rows.length > 0 ? 'mixed' : null,
    };
  });
}
