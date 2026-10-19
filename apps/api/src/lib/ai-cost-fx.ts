import {
  allocateAiBillingPool,
  convertMoney,
  convertMoneyParts,
  projectCurrencySchema,
  roundAiMoney,
  type AiBillingAllocationMethod,
  type AiBillingEntryType,
  type FxConversion,
  type FxRate,
} from '@project-knowledge-hub/domain';

export type CostSlice = {
  period: string;
  aiSystemId: string | null;
  currency: string;
  type: AiBillingEntryType;
  amount: number;
  onDate: string;
};

export type SliceCandidate = {
  projectId: string;
  name: string;
  slug: string;
  currency: string;
  active: boolean;
  tokens: number;
  overridePercent: number | null;
};

export type FoldedChartPoint = {
  period: string;
  currency: string;
  subscription: number;
  planChange: number;
  onDemand: number;
  theoretical: number;
  fxRate: number | null;
  fxRateDate: string | null;
  fxSource: string | null;
};

export type FoldedProjectShare = {
  projectId: string;
  name: string;
  slug: string;
  tokens: number;
  overridePercent: number | null;
  method: AiBillingAllocationMethod;
  originalAmount: number;
  projectAmount: number;
  projectCurrency: string;
  reportingAmount: number;
  fxRate: number | null;
  fxRateDate: string | null;
  fxSource: string | null;
};

export type FoldedPool = {
  period: string;
  aiSystemId: string | null;
  originalCurrency: string;
  originalPaidTotal: number;
  reportingPaidTotal: number;
  reportingCurrency: string;
  converted: boolean;
  fxRate: number | null;
  fxRateDate: string | null;
  fxSource: string | null;
  projects: FoldedProjectShare[];
};

export type ProjectLedgerShare = {
  period: string;
  aiSystemId: string | null;
  amount: number;
  subscription: number;
  planChange: number;
  onDemand: number;
  covered: boolean;
  reportingAmount: number;
  /** One conversion per paid slice that booked onto this project. */
  conversions: FxConversion[];
  fx: FxConversion;
};

type ChartBucket = FoldedChartPoint;

type ProjectAcc = FoldedProjectShare & { fxMixed: boolean };

type PoolAcc = {
  period: string;
  aiSystemId: string | null;
  originalCurrency: string;
  originalPaidTotal: number;
  reportingPaidTotal: number;
  reportingCurrency: string;
  converted: boolean;
  fxRate: number | null;
  fxRateDate: string | null;
  fxSource: string | null;
  fxMixed: boolean;
  projects: Map<string, ProjectAcc>;
};

type LedgerAcc = {
  period: string;
  aiSystemId: string | null;
  subscription: number;
  planChange: number;
  onDemand: number;
  reportingAmount: number;
  covered: boolean;
  conversions: FxConversion[];
  fx: FxConversion;
  fxMixed: boolean;
};

function noteFx(current: ChartBucket, conversion: FxConversion): void {
  if (conversion.source == null) return;
  if (current.fxSource == null) {
    current.fxRate = conversion.rate;
    current.fxRateDate = conversion.rateDate;
    current.fxSource = conversion.source;
    return;
  }
  if (
    current.fxSource !== conversion.source ||
    current.fxRateDate !== conversion.rateDate ||
    current.fxRate !== conversion.rate
  ) {
    current.fxRate = null;
    current.fxRateDate = conversion.rateDate;
    current.fxSource = 'mixed';
  }
}

function addPaid(bucket: ChartBucket, type: AiBillingEntryType, amount: number): void {
  if (type === 'subscription') bucket.subscription += amount;
  else if (type === 'plan_change') bucket.planChange += amount;
  else bucket.onDemand += amount;
}

function chartKey(period: string, currency: string): string {
  return `${period}|${currency}`;
}

function ensureChart(
  chart: Map<string, ChartBucket>,
  period: string,
  currency: string,
): ChartBucket {
  const key = chartKey(period, currency);
  const existing = chart.get(key);
  if (existing) return existing;
  const created: ChartBucket = {
    period,
    currency,
    subscription: 0,
    planChange: 0,
    onDemand: 0,
    theoretical: 0,
    fxRate: null,
    fxRateDate: null,
    fxSource: null,
  };
  chart.set(key, created);
  return created;
}

function poolKey(slice: CostSlice): string {
  return `${slice.period}|${slice.aiSystemId ?? ''}|${slice.currency}`;
}

function finishChart(chart: Map<string, ChartBucket>): FoldedChartPoint[] {
  return [...chart.values()]
    .map((row) => ({
      ...row,
      subscription: roundAiMoney(row.subscription),
      planChange: roundAiMoney(row.planChange),
      onDemand: roundAiMoney(row.onDemand),
      theoretical: roundAiMoney(row.theoretical),
    }))
    .sort(
      (left, right) =>
        left.period.localeCompare(right.period) || left.currency.localeCompare(right.currency),
    );
}

function rememberFx(
  pool: PoolAcc,
  conversion: FxConversion,
): void {
  if (!pool.fxSource) {
    pool.fxRate = conversion.rate;
    pool.fxRateDate = conversion.rateDate;
    pool.fxSource = conversion.source;
    return;
  }
  if (
    pool.fxSource !== conversion.source ||
    pool.fxRateDate !== conversion.rateDate ||
    pool.fxRate !== conversion.rate
  ) {
    pool.fxMixed = true;
    pool.fxRate = null;
    pool.fxSource = 'mixed';
  }
}

/**
 * Allocate each paid slice across every candidate project, then convert the
 * share into the project currency and the reporting currency at the slice date.
 */
export function foldBillingSlices(input: {
  slices: readonly CostSlice[];
  candidates: (slice: CostSlice) => readonly SliceCandidate[];
  reportingCurrency: string;
  rates: readonly FxRate[];
}): {
  reportingChart: FoldedChartPoint[];
  originalChart: FoldedChartPoint[];
  pools: FoldedPool[];
  sharesByProject: Map<string, ProjectLedgerShare[]>;
} {
  const reportingChart = new Map<string, ChartBucket>();
  const originalChart = new Map<string, ChartBucket>();
  const pools = new Map<string, PoolAcc>();
  const ledger = new Map<string, LedgerAcc>();

  for (const slice of input.slices) {
    const amount = roundAiMoney(slice.amount);
    const originalBucket = ensureChart(originalChart, slice.period, slice.currency);
    addPaid(originalBucket, slice.type, amount);

    const reportingConversion = convertMoney(
      amount,
      slice.currency,
      input.reportingCurrency,
      slice.onDate,
      input.rates,
    );
    const reportingBucket = ensureChart(
      reportingChart,
      slice.period,
      reportingConversion.currency,
    );
    addPaid(reportingBucket, slice.type, reportingConversion.amount);
    noteFx(reportingBucket, reportingConversion);

    const projects = input.candidates(slice);
    const allocated =
      projects.length === 0
        ? []
        : allocateAiBillingPool({
            paidTotal: amount,
            projects: projects.map((project) => ({
              projectId: project.projectId,
              tokens: project.tokens,
              active: project.active,
              overridePercent: project.overridePercent,
            })),
          });
    const candidateById = new Map(projects.map((project) => [project.projectId, project]));
    const byCurrency = new Map<string, Array<{ project: SliceCandidate; original: number; method: AiBillingAllocationMethod }>>();
    for (const share of allocated) {
      const project = candidateById.get(share.projectId);
      if (!project) continue;
      const group = byCurrency.get(project.currency) ?? [];
      group.push({ project, original: share.amount, method: share.method });
      byCurrency.set(project.currency, group);
    }

    const projectFx = new Map<
      string,
      { amount: number; fx: FxConversion; method: AiBillingAllocationMethod; original: number }
    >();
    for (const [currency, group] of byCurrency) {
      const converted = convertMoneyParts(
        group.map((row) => row.original),
        slice.currency,
        currency,
        slice.onDate,
        input.rates,
      );
      const booked = converted.conversion.currency === currency;
      group.forEach((row, index) => {
        const amount = booked ? (converted.amounts[index] ?? 0) : 0;
        projectFx.set(row.project.projectId, {
          amount,
          fx: {
            originalAmount: row.original,
            originalCurrency: slice.currency,
            amount: booked ? amount : row.original,
            currency: booked ? currency : slice.currency,
            rate: booked ? converted.conversion.rate : null,
            rateDate: booked ? converted.conversion.rateDate : null,
            source: booked ? converted.conversion.source : null,
          },
          method: row.method,
          original: row.original,
        });
      });
    }

    const reportingParts = convertMoneyParts(
      allocated.map((share) => share.amount),
      slice.currency,
      input.reportingCurrency,
      slice.onDate,
      input.rates,
    );
    const reportingBooked = reportingParts.conversion.currency === input.reportingCurrency;

    const pool = pools.get(poolKey(slice)) ?? {
      period: slice.period,
      aiSystemId: slice.aiSystemId,
      originalCurrency: slice.currency,
      originalPaidTotal: 0,
      reportingPaidTotal: 0,
      reportingCurrency: input.reportingCurrency,
      converted: true,
      fxRate: null,
      fxRateDate: null,
      fxSource: null,
      fxMixed: false,
      projects: new Map<string, ProjectAcc>(),
    };
    pool.originalPaidTotal += amount;
    if (reportingBooked) pool.reportingPaidTotal += reportingConversion.amount;
    else pool.converted = false;
    rememberFx(pool, reportingConversion);

    allocated.forEach((share, index) => {
      const project = candidateById.get(share.projectId);
      const fx = projectFx.get(share.projectId);
      if (!project || !fx) return;
      const reportingAmount = reportingBooked ? (reportingParts.amounts[index] ?? 0) : 0;
      const current = pool.projects.get(project.projectId) ?? {
        projectId: project.projectId,
        name: project.name,
        slug: project.slug,
        tokens: project.tokens,
        overridePercent: project.overridePercent,
        method: fx.method,
        originalAmount: 0,
        projectAmount: 0,
        projectCurrency: project.currency,
        reportingAmount: 0,
        fxRate: fx.fx.rate,
        fxRateDate: fx.fx.rateDate,
        fxSource: fx.fx.source,
        fxMixed: false,
      };
      current.originalAmount += fx.original;
      current.projectAmount += fx.amount;
      current.reportingAmount += reportingAmount;
      current.tokens = project.tokens;
      current.overridePercent = project.overridePercent;
      if (Math.abs(fx.original) >= Math.abs(current.originalAmount) || current.method === 'equal') {
        current.method = fx.method;
      }
      if (
        current.fxSource !== fx.fx.source ||
        current.fxRateDate !== fx.fx.rateDate ||
        current.fxRate !== fx.fx.rate
      ) {
        current.fxMixed = true;
        current.fxRate = null;
        current.fxSource = 'mixed';
      }
      pool.projects.set(project.projectId, current);

      const bookedToProject = fx.fx.currency === project.currency;
      if (!bookedToProject) return;
      const ledgerKey = `${project.projectId}|${slice.period}|${slice.aiSystemId ?? ''}`;
      const row = ledger.get(ledgerKey) ?? {
        period: slice.period,
        aiSystemId: slice.aiSystemId,
        subscription: 0,
        planChange: 0,
        onDemand: 0,
        reportingAmount: 0,
        covered: true,
        conversions: [],
        fx: fx.fx,
        fxMixed: false,
      };
      row.conversions.push(fx.fx);
      if (slice.type === 'subscription') row.subscription += fx.amount;
      else if (slice.type === 'plan_change') row.planChange += fx.amount;
      else row.onDemand += fx.amount;
      row.reportingAmount += reportingAmount;
      if (
        row.fx.source !== fx.fx.source ||
        row.fx.rateDate !== fx.fx.rateDate ||
        row.fx.rate !== fx.fx.rate
      ) {
        row.fxMixed = true;
      }
      ledger.set(ledgerKey, row);
    });
    pools.set(poolKey(slice), pool);
  }

  const sharesByProject = new Map<string, ProjectLedgerShare[]>();
  for (const [key, row] of ledger) {
    const projectId = key.slice(0, key.indexOf('|'));
    const share: ProjectLedgerShare = {
      period: row.period,
      aiSystemId: row.aiSystemId,
      amount: roundAiMoney(row.subscription + row.planChange + row.onDemand),
      subscription: roundAiMoney(row.subscription),
      planChange: roundAiMoney(row.planChange),
      onDemand: roundAiMoney(row.onDemand),
      covered: row.covered,
      reportingAmount: roundAiMoney(row.reportingAmount),
      conversions: row.conversions,
      fx: row.fxMixed
        ? { ...row.fx, rate: null, rateDate: null, source: 'mixed' }
        : row.fx,
    };
    const list = sharesByProject.get(projectId) ?? [];
    list.push(share);
    sharesByProject.set(projectId, list);
  }

  const foldedPools: FoldedPool[] = [...pools.values()]
    .map((pool) => ({
      period: pool.period,
      aiSystemId: pool.aiSystemId,
      originalCurrency: pool.originalCurrency,
      originalPaidTotal: roundAiMoney(pool.originalPaidTotal),
      reportingPaidTotal: roundAiMoney(pool.reportingPaidTotal),
      reportingCurrency: pool.reportingCurrency,
      converted: pool.converted,
      fxRate: pool.fxMixed ? null : pool.fxRate,
      fxRateDate: pool.fxRateDate,
      fxSource: pool.fxMixed ? 'mixed' : pool.fxSource,
      projects: [...pool.projects.values()]
        .map((project) => ({
          projectId: project.projectId,
          name: project.name,
          slug: project.slug,
          tokens: project.tokens,
          overridePercent: project.overridePercent,
          method: project.method,
          originalAmount: roundAiMoney(project.originalAmount),
          projectAmount: roundAiMoney(project.projectAmount),
          projectCurrency: project.projectCurrency,
          reportingAmount: roundAiMoney(project.reportingAmount),
          fxRate: project.fxMixed ? null : project.fxRate,
          fxRateDate: project.fxRateDate,
          fxSource: project.fxMixed ? 'mixed' : project.fxSource,
        }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    }))
    .sort(
      (left, right) =>
        right.period.localeCompare(left.period) ||
        left.originalCurrency.localeCompare(right.originalCurrency) ||
        (left.aiSystemId ?? '').localeCompare(right.aiSystemId ?? ''),
    );

  return {
    reportingChart: finishChart(reportingChart),
    originalChart: finishChart(originalChart),
    pools: foldedPools,
    sharesByProject,
  };
}

/** Null or unknown stored currency means the project currency. */
export function tokenRateCurrency(
  stored: string | null | undefined,
  projectCurrency: string,
): string {
  const parsed = projectCurrencySchema.safeParse((stored ?? '').trim().toUpperCase());
  if (parsed.success) return parsed.data;
  const project = projectCurrencySchema.safeParse(projectCurrency);
  return project.success ? project.data : projectCurrency;
}

/**
 * Sum list-price parts into `to`. A part with no quote stays out of the total
 * so a foreign amount is not labelled as `to`.
 */
export function sumTheoreticalInCurrency(input: {
  parts: readonly { amount: number; onDate: string }[];
  from: string;
  to: string;
  rates: readonly FxRate[];
}): number {
  let total = 0;
  for (const part of input.parts) {
    const converted = convertMoney(part.amount, input.from, input.to, part.onDate, input.rates);
    if (converted.currency === input.to) total += converted.amount;
  }
  return roundAiMoney(total);
}

export function addTheoreticalCost(
  chart: FoldedChartPoint[],
  input: {
    period: string;
    amount: number;
    currency: string;
    reportingCurrency: string;
    onDate: string;
    rates: readonly FxRate[];
  },
): { chart: FoldedChartPoint[]; conversion: FxConversion } {
  const conversion = convertMoney(
    input.amount,
    input.currency,
    input.reportingCurrency,
    input.onDate,
    input.rates,
  );
  const next = chart.map((point) => ({ ...point }));
  const bucket =
    next.find((point) => point.period === input.period && point.currency === conversion.currency) ??
    null;
  if (bucket) {
    bucket.theoretical = roundAiMoney(bucket.theoretical + conversion.amount);
    if (bucket.fxSource && bucket.fxSource !== conversion.source) {
      bucket.fxSource = 'mixed';
      bucket.fxRate = null;
    } else if (!bucket.fxSource) {
      bucket.fxRate = conversion.rate;
      bucket.fxRateDate = conversion.rateDate;
      bucket.fxSource = conversion.source;
    }
  } else {
    next.push({
      period: input.period,
      currency: conversion.currency,
      subscription: 0,
      planChange: 0,
      onDemand: 0,
      theoretical: conversion.amount,
      fxRate: conversion.rate,
      fxRateDate: conversion.rateDate,
      fxSource: conversion.source,
    });
  }
  next.sort(
    (left, right) =>
      left.period.localeCompare(right.period) || left.currency.localeCompare(right.currency),
  );
  return { chart: next, conversion };
}
