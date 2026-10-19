import {
  currentAiBillingPeriod,
  fillAiCostChart,
  fillPlatformAiCostMonths,
  listAiBillingPeriods,
  periodsCoveredByEntry,
  resolveAiCostViewWindow,
  shiftAiBillingPeriod,
  type AiCostChartMonth,
  type AiCostViewRange,
} from '@project-knowledge-hub/domain';
import type { PlatformAiCostReport, WorkspaceAiCostOverview } from './ai-billing.js';

export type AiCostWindowQuery = {
  from?: string;
  to?: string;
  range?: string;
};

type CoverageEntry = {
  amount: number;
  period: string;
  currency: string;
  servicePeriodStart?: string | null;
  servicePeriodEnd?: string | null;
};

type LedgerEntry = CoverageEntry & {
  convertedAmount?: number;
  convertedCurrency?: string;
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

export function presentWorkspaceAiCost(
  overview: WorkspaceAiCostOverview,
  query: AiCostWindowQuery,
  now = new Date(),
): Omit<WorkspaceAiCostOverview, 'chart' | 'originalChart'> & {
  chart: AiCostChartMonth[];
  originalChart: AiCostChartMonth[];
  from: string;
  to: string;
  range: AiCostViewRange;
} {
  const reportingEntries = reportingCoverage(overview.entries);
  const originalEntries = originalCoverage(overview.entries);
  const window = resolveAiCostViewWindow(
    {
      from: query.from,
      to: query.to,
      range: query.range,
      knownPeriods: knownPeriods(
        [...overview.chart, ...overview.originalChart],
        [...reportingEntries, ...originalEntries],
        now,
      ),
    },
    now,
  );
  return {
    ...overview,
    from: window.from,
    to: window.to,
    range: window.range,
    chart: fillAiCostChart(
      {
        points: overview.chart,
        entries: reportingEntries,
        from: window.from,
        to: window.to,
      },
      now,
    ),
    originalChart: fillAiCostChart(
      {
        points: overview.originalChart,
        entries: originalEntries,
        from: window.from,
        to: window.to,
      },
      now,
    ),
  };
}

/**
 * Bounds passed to the platform loader. "All" uses a wide fetch so the
 * tight window can be derived from the rows that come back.
 */
export function platformAiCostFetchWindow(
  query: AiCostWindowQuery,
  now = new Date(),
): { from?: string; to?: string; range: AiCostViewRange; discoverAll: boolean } {
  const from = query.from?.trim() ?? '';
  const to = query.to?.trim() ?? '';
  if (from || to) {
    const window = resolveAiCostViewWindow({ from, to }, now);
    return { from: window.from, to: window.to, range: 'custom', discoverAll: false };
  }
  if (query.range === 'year') {
    const window = resolveAiCostViewWindow({ range: 'year' }, now);
    return { from: window.from, to: window.to, range: 'year', discoverAll: false };
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
  const window = resolveAiCostViewWindow({ range: 'last12' }, now);
  return { from: window.from, to: window.to, range: 'last12', discoverAll: false };
}

export function presentPlatformAiCost(
  report: PlatformAiCostReport,
  query: AiCostWindowQuery,
  now = new Date(),
): PlatformAiCostReport & { range: AiCostViewRange } {
  const fetch = platformAiCostFetchWindow(query, now);
  const ledger = report.entries as Array<
    (typeof report.entries)[number] & {
      convertedAmount?: number;
      convertedCurrency?: string;
    }
  >;
  const reportingEntries = ledger.map((entry) => ({
    ...reportingCoverage([entry])[0]!,
    workspaceId: entry.workspaceId,
    workspaceName: entry.workspaceName,
    workspaceSlug: entry.workspaceSlug,
  }));
  const originalEntries = ledger.map((entry) => ({
    ...originalCoverage([entry])[0]!,
    workspaceId: entry.workspaceId,
    workspaceName: entry.workspaceName,
    workspaceSlug: entry.workspaceSlug,
  }));
  const window = fetch.discoverAll
    ? resolveAiCostViewWindow(
        {
          range: 'all',
          knownPeriods: knownPeriods(
            [...report.months, ...report.originalMonths],
            [...reportingEntries, ...originalEntries],
            now,
          ),
        },
        now,
      )
    : { from: report.from, to: report.to, range: fetch.range };
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
  return {
    ...report,
    from: window.from,
    to: window.to,
    range: window.range,
    periods: listAiBillingPeriods(window.from, window.to),
    months: filled.months,
    totals: totalsWithFx(filled.totals, filled.months, report.totals),
    originalMonths: originalFilled.months,
    originalTotals: totalsWithFx(
      originalFilled.totals,
      originalFilled.months,
      report.originalTotals,
    ),
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
