import { AppError } from './index.js';
import { aiBillingPeriodSchema } from './ai-cost.js';

/**
 * Paid AI cost allocation (PRO-T-39).
 *
 * A billing ledger entry belongs to one pool: a calendar month, a currency,
 * and either one AI system or the workspace (no system). A pool's paid total
 * is the sum of its entries (`subscription` + `plan_change` + `on_demand`).
 * `plan_change` may be negative (a downgrade credit).
 *
 * That total is split across projects once:
 * 1. Manual percent overrides on a pool are applied first. They must sum to
 *    at most 100. Each override is that percent of the pool total.
 * 2. Any remainder (or the whole total, when nobody set an override) is split
 *    in proportion to token usage in that pool's month. A workspace pool
 *    counts every project's tokens. A system pool counts tokens reported
 *    against that system. Projects with no tokens get nothing in this step.
 * 3. When the remainder has no tokens, it is split equally across active
 *    projects (not archived, not completed). Completed projects still receive
 *    a token share when they used tokens.
 *
 * Shares are rounded to cents. The largest fractional share takes the leftover
 * cent so the shares of a fully allocated pool sum to the pool total. They
 * never sum to more than that total.
 *
 * When a pool has no ledger entries, `aiFlatMonthlyFee` is a synthetic
 * subscription for that month (the PRO-T-38 day-fraction accrual). Existing
 * actual cost is left unchanged when the workspace has no ledger entries at
 * all: the caller passes the legacy bill and `ledgerEmpty: true`.
 */

export const AI_BILLING_ENTRY_TYPES = [
  'subscription',
  'plan_change',
  'on_demand',
] as const;

export type AiBillingEntryType = (typeof AI_BILLING_ENTRY_TYPES)[number];

/** Statuses that take an equal share when a month has no token usage. */
export const AI_BILLING_ACTIVE_STATUSES = [
  'idea',
  'planned',
  'active',
  'maintenance',
  'paused',
] as const;

/** Same month length the flat-fee accrual uses (30.437 days). */
export const AI_BILLING_AVG_DAYS_PER_MONTH = 30.437;

export type AiBillingAllocationMethod = 'override' | 'tokens' | 'equal';

export type AiBillingAllocationProject = {
  projectId: string;
  /** Tokens in this pool's month and scope. */
  tokens: number;
  /** Equal-split candidate: not archived and not completed. */
  active: boolean;
  /** 0–100, or null when this project has no manual override. */
  overridePercent: number | null;
};

export type AiBillingAllocationShare = {
  projectId: string;
  amount: number;
  method: AiBillingAllocationMethod;
};

export function roundAiMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export type AiBillingMonthParts = {
  period: string;
  currency: string;
  subscription: number;
  planChange: number;
  onDemand: number;
  theoreticalApiCost: number;
};

export type AiBillingMonthSummary = AiBillingMonthParts & {
  paidCost: number;
  difference: number;
  ratio: number | null;
};

/** Paid cost is the sum of the three ledger types. `planChange` may be negative. */
export function aiBillingPaidCost(
  parts: Pick<AiBillingMonthParts, 'subscription' | 'planChange' | 'onDemand'>,
): number {
  return roundAiMoney(parts.subscription + parts.planChange + parts.onDemand);
}

/**
 * Difference is paid minus theoretical. Ratio is paid / theoretical, to three
 * decimals, and is null when theoretical is not positive.
 */
export function aiBillingCostComparison(
  paidCost: number,
  theoreticalApiCost: number,
): { difference: number; ratio: number | null } {
  const paid = roundAiMoney(paidCost);
  const theoretical = roundAiMoney(theoreticalApiCost);
  return {
    difference: roundAiMoney(paid - theoretical),
    ratio:
      theoretical > 0 ? Math.round((paid / theoretical) * 1000) / 1000 : null,
  };
}

export function summarizeAiBillingMonth(
  parts: AiBillingMonthParts,
): AiBillingMonthSummary {
  const subscription = roundAiMoney(parts.subscription);
  const planChange = roundAiMoney(parts.planChange);
  const onDemand = roundAiMoney(parts.onDemand);
  const theoreticalApiCost = roundAiMoney(parts.theoreticalApiCost);
  const paidCost = aiBillingPaidCost({ subscription, planChange, onDemand });
  return {
    period: parts.period,
    currency: parts.currency,
    subscription,
    planChange,
    onDemand,
    theoreticalApiCost,
    paidCost,
    ...aiBillingCostComparison(paidCost, theoreticalApiCost),
  };
}

export type AiBillingEntryMonthSlice = {
  period: string;
  amount: number;
};

/**
 * Months a cost entry contributes to, and the amount in each.
 * Today the whole amount stays on `period`. Do not prorate here.
 * When service-period dates exist, replace this body with
 * `splitBillingEntryByMonth` (PRO-T-104).
 */
export function aiBillingEntryMonthSlices(entry: {
  period: string;
  amount: number;
}): AiBillingEntryMonthSlice[] {
  return [{ period: entry.period, amount: entry.amount }];
}

export function isAiBillingActiveProject(
  status: string,
  archivedAt: Date | string | null | undefined,
): boolean {
  if (archivedAt) return false;
  return (AI_BILLING_ACTIVE_STATUSES as readonly string[]).includes(status);
}

export function assertAiBillingPeriod(value: string): string {
  const parsed = aiBillingPeriodSchema.safeParse(value.trim());
  if (!parsed.success) {
    throw new AppError({
      code: 'BILLING_PERIOD_INVALID',
      message: 'period must be YYYY-MM',
      statusCode: 400,
    });
  }
  return parsed.data;
}

export function assertAllocationPercent(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new AppError({
      code: 'BILLING_ALLOCATION_INVALID',
      message: 'Allocation percent must be between 0 and 100',
      statusCode: 400,
    });
  }
  return value;
}

/**
 * Split `total` by positive weights. The result sums to `roundAiMoney(total)`.
 * A non-positive weight is a zero share. An all-zero weight list splits equally.
 */
export function splitAiMoney(
  total: number,
  weights: readonly number[],
): number[] {
  const count = weights.length;
  if (count === 0) return [];
  const target = Math.round(total * 100);
  const sign = target < 0 ? -1 : 1;
  const cents = Math.abs(target);
  const safe = weights.map((weight) =>
    Number.isFinite(weight) && weight > 0 ? weight : 0,
  );
  const weightSum = safe.reduce((sum, weight) => sum + weight, 0);
  const raw =
    weightSum > 0
      ? safe.map((weight) => (cents * weight) / weightSum)
      : safe.map(() => cents / count);
  const floors = raw.map((value) => Math.floor(value));
  let leftover = cents - floors.reduce((sum, value) => sum + value, 0);
  const order = raw
    .map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((a, b) => b.frac - a.frac || a.index - b.index);
  for (let i = 0; leftover > 0 && order.length > 0; i += 1) {
    const slot = order[i % order.length];
    if (!slot) break;
    floors[slot.index] = (floors[slot.index] ?? 0) + 1;
    leftover -= 1;
  }
  return floors.map((value) => (sign * value) / 100);
}

function allocateDefault(
  total: number,
  projects: readonly AiBillingAllocationProject[],
): AiBillingAllocationShare[] {
  const withTokens = projects.filter((project) => project.tokens > 0);
  if (withTokens.length > 0) {
    const amounts = splitAiMoney(
      total,
      projects.map((project) => project.tokens),
    );
    return projects.map((project, index) => ({
      projectId: project.projectId,
      amount: amounts[index] ?? 0,
      method: 'tokens' as const,
    }));
  }
  const active = projects.filter((project) => project.active);
  const pool = active.length > 0 ? active : projects;
  if (pool.length === 0) {
    return projects.map((project) => ({
      projectId: project.projectId,
      amount: 0,
      method: 'equal' as const,
    }));
  }
  const activeIds = new Set(pool.map((project) => project.projectId));
  const amounts = splitAiMoney(
    total,
    projects.map((project) => (activeIds.has(project.projectId) ? 1 : 0)),
  );
  return projects.map((project, index) => ({
    projectId: project.projectId,
    amount: amounts[index] ?? 0,
    method: 'equal' as const,
  }));
}

/** Allocate one pool. Throws when override percents sum to more than 100. */
export function allocateAiBillingPool(input: {
  paidTotal: number;
  projects: readonly AiBillingAllocationProject[];
}): AiBillingAllocationShare[] {
  const projects = input.projects;
  const overrides = projects.filter(
    (project) => project.overridePercent != null,
  );
  if (overrides.length === 0) {
    return allocateDefault(input.paidTotal, projects);
  }

  const percents = overrides.map((project) =>
    assertAllocationPercent(project.overridePercent ?? 0),
  );
  const percentSum = percents.reduce((sum, value) => sum + value, 0);
  if (percentSum > 100 + 1e-9) {
    throw new AppError({
      code: 'BILLING_ALLOCATION_INVALID',
      message: 'Allocation overrides for a period must sum to at most 100',
      statusCode: 400,
    });
  }

  const overrideBudget = input.paidTotal * (percentSum / 100);
  const overrideAmounts = splitAiMoney(overrideBudget, percents);
  const overrideById = new Map<string, number>();
  overrides.forEach((project, index) => {
    overrideById.set(project.projectId, overrideAmounts[index] ?? 0);
  });
  const overrideSum = overrideAmounts.reduce((sum, value) => sum + value, 0);
  const remainder = roundAiMoney(input.paidTotal - overrideSum);
  const rest = projects.filter((project) => project.overridePercent == null);
  const restShares = allocateDefault(remainder, rest);
  const restById = new Map(
    restShares.map((share) => [share.projectId, share]),
  );

  return projects.map((project) => {
    if (project.overridePercent != null) {
      return {
        projectId: project.projectId,
        amount: overrideById.get(project.projectId) ?? 0,
        method: 'override' as const,
      };
    }
    return (
      restById.get(project.projectId) ?? {
        projectId: project.projectId,
        amount: 0,
        method: 'equal' as const,
      }
    );
  });
}

export type AiBillingTypeAmounts = {
  subscription: number;
  planChange: number;
  onDemand: number;
};

/**
 * Scale a pool's type totals so they sum to one project's share.
 * `planChange` may be negative; the on-demand part absorbs the rounding cent.
 */
export function scaleAiBillingTypes(
  amount: number,
  types: AiBillingTypeAmounts,
): AiBillingTypeAmounts {
  const total = types.subscription + types.planChange + types.onDemand;
  if (total === 0 || amount === 0) {
    return { subscription: 0, planChange: 0, onDemand: 0 };
  }
  const subscription = roundAiMoney((amount * types.subscription) / total);
  const planChange = roundAiMoney((amount * types.planChange) / total);
  const onDemand = roundAiMoney(amount - subscription - planChange);
  return { subscription, planChange, onDemand };
}

function daysInCalendarMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Unrounded flat-fee shares for each calendar month in the accrued window.
 * The shares sum to `fee * elapsedDays / 30.437` (one full fee when the
 * project has no start/end). The caller rounds.
 */
export function flatFeeMonthShares(input: {
  monthlyFee: number;
  startDate: string | null;
  endDate: string | null;
  today: string;
}): Array<{ period: string; amount: number }> {
  const { monthlyFee, startDate, endDate, today } = input;
  if (!(monthlyFee > 0)) return [];
  const todayPeriod = today.slice(0, 7);
  if (!startDate || !endDate) {
    return [{ period: todayPeriod, amount: monthlyFee }];
  }
  if (today < startDate) return [];
  const capped = today > endDate ? endDate : today;
  const [startYear, startMonth, startDay] = startDate.split('-').map(Number);
  const [endYear, endMonth, endDay] = capped.split('-').map(Number);
  if (
    !startYear ||
    !startMonth ||
    !startDay ||
    !endYear ||
    !endMonth ||
    !endDay
  ) {
    return [];
  }
  const shares: Array<{ period: string; amount: number }> = [];
  let year = startYear;
  let month = startMonth;
  while (year < endYear || (year === endYear && month <= endMonth)) {
    const dim = daysInCalendarMonth(year, month);
    const fromDay = year === startYear && month === startMonth ? startDay : 1;
    const toDay = year === endYear && month === endMonth ? endDay : dim;
    const days = Math.max(0, toDay - fromDay + 1);
    if (days > 0) {
      shares.push({
        period: `${year}-${String(month).padStart(2, '0')}`,
        amount:
          (monthlyFee * days) / AI_BILLING_AVG_DAYS_PER_MONTH,
      });
    }
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return shares;
}

export type AiPaidPeriodSource = 'ledger' | 'fallback' | 'mixed';

export type AiPaidPeriod = {
  period: string;
  paidCost: number;
  subscription: number;
  planChange: number;
  onDemand: number;
  /** Legacy api/mixed token cost kept in AC only for months the ledger does not cover. */
  legacyToken: number;
  theoreticalApiCost: number;
  difference: number;
  ratio: number | null;
  source: AiPaidPeriodSource;
};

export type AiBillingProjectShare = {
  period: string;
  /** Null is the workspace-wide pool. */
  aiSystemId: string | null;
  amount: number;
  subscription: number;
  planChange: number;
  onDemand: number;
  /** This project is a candidate for the pool, even when its share is zero. */
  covered: boolean;
};

export type AiCostUsageSlice = {
  period: string | null;
  systemId: string | null;
  theoretical: number;
  /** Mode-gated token cost (api/mixed only). Zero for flat and note_only. */
  legacyToken: number;
  tokens: number;
};

export type AiFallbackSystem = {
  systemId: string;
  costMode: 'flat' | 'api' | 'mixed' | 'note_only' | null;
  flatMonthlyFee: number;
  /** PRO-T-38 bill for this system. Used when the ledger is empty. */
  legacyBillable: number;
};

export type SettleProjectAiCostInput = {
  today: string;
  startDate: string | null;
  endDate: string | null;
  systems: readonly AiFallbackSystem[];
  legacyBillableCost: number;
  /**
   * True when no same-currency ledger entry can cover this project.
   * Paid AC is then the legacy bill, exactly.
   */
  ledgerEmpty: boolean;
  shares: readonly AiBillingProjectShare[];
  usage: readonly AiCostUsageSlice[];
};

export type SettledProjectAiCost = {
  aiPaidAc: number;
  aiTheoreticalApiCost: number;
  periods: AiPaidPeriod[];
  systemPaid: Array<{ systemId: string; amount: number }>;
};

type MutablePeriod = {
  period: string;
  subscription: number;
  planChange: number;
  onDemand: number;
  /** Flat fee for systems the ledger does not cover this month. */
  fallbackFlat: number;
  legacyToken: number;
  theoretical: number;
  workspaceCovered: boolean;
  coveredSystems: Set<string>;
  systemPaid: Map<string, number>;
};

function emptyPeriod(period: string): MutablePeriod {
  return {
    period,
    subscription: 0,
    planChange: 0,
    onDemand: 0,
    fallbackFlat: 0,
    legacyToken: 0,
    theoretical: 0,
    workspaceCovered: false,
    coveredSystems: new Set(),
    systemPaid: new Map(),
  };
}

function addSystemPaid(
  row: MutablePeriod,
  systemId: string,
  amount: number,
): void {
  row.systemPaid.set(systemId, (row.systemPaid.get(systemId) ?? 0) + amount);
}

function periodCovered(row: MutablePeriod, systemId: string | null): boolean {
  if (row.workspaceCovered) return true;
  if (systemId && row.coveredSystems.has(systemId)) return true;
  return false;
}

function finishPeriod(row: MutablePeriod): AiPaidPeriod {
  const ledgerSubscription = roundAiMoney(row.subscription);
  const fallbackFlat = roundAiMoney(row.fallbackFlat);
  const subscription = roundAiMoney(ledgerSubscription + fallbackFlat);
  const planChange = roundAiMoney(row.planChange);
  const onDemand = roundAiMoney(row.onDemand);
  const legacyToken = roundAiMoney(row.legacyToken);
  const paidCost = roundAiMoney(
    subscription + planChange + onDemand + legacyToken,
  );
  const theoreticalApiCost = roundAiMoney(row.theoretical);
  const comparison = aiBillingCostComparison(paidCost, theoreticalApiCost);
  const hasLedger = row.workspaceCovered || row.coveredSystems.size > 0;
  const hasFallback = Math.abs(fallbackFlat) > 0 || Math.abs(legacyToken) > 0;
  const source: AiPaidPeriodSource = row.workspaceCovered
    ? 'ledger'
    : hasLedger && hasFallback
      ? 'mixed'
      : hasLedger
        ? 'ledger'
        : 'fallback';
  return {
    period: row.period,
    paidCost,
    subscription,
    planChange,
    onDemand,
    legacyToken,
    theoreticalApiCost,
    difference: comparison.difference,
    ratio: comparison.ratio,
    source,
  };
}

function tokensForSystemPeriod(
  usage: readonly AiCostUsageSlice[],
  period: string,
  systemId: string,
): number {
  return usage
    .filter((slice) => slice.period === period && slice.systemId === systemId)
    .reduce((sum, slice) => sum + slice.tokens, 0);
}

function distributeWorkspaceShare(
  row: MutablePeriod,
  amount: number,
  types: AiBillingTypeAmounts,
  systems: readonly AiFallbackSystem[],
  usage: readonly AiCostUsageSlice[],
): void {
  row.subscription += types.subscription;
  row.planChange += types.planChange;
  row.onDemand += types.onDemand;
  if (systems.length === 0 || amount === 0) return;
  const weights = systems.map((system) =>
    tokensForSystemPeriod(usage, row.period, system.systemId),
  );
  const tokenSum = weights.reduce((sum, value) => sum + value, 0);
  const billable: number[] = systems.map((system) =>
    system.costMode === 'flat' ||
    system.costMode === 'api' ||
    system.costMode === 'mixed'
      ? 1
      : 0,
  );
  const billableSum = billable.reduce((sum, value) => sum + value, 0);
  const chosen = tokenSum > 0 ? weights : billableSum > 0 ? billable : systems.map(() => 1);
  const parts = splitAiMoney(amount, chosen);
  systems.forEach((system, index) => {
    addSystemPaid(row, system.systemId, parts[index] ?? 0);
  });
}

function lockPaidToLegacy(
  periods: AiPaidPeriod[],
  legacyBillable: number,
): AiPaidPeriod[] {
  if (periods.length === 0) return periods;
  const sum = periods.reduce((total, period) => total + period.paidCost, 0);
  const delta = roundAiMoney(legacyBillable - sum);
  if (delta === 0) return periods;
  const last = periods[periods.length - 1]!;
  const subscription = roundAiMoney(last.subscription + delta);
  const paidCost = roundAiMoney(last.paidCost + delta);
  const comparison = aiBillingCostComparison(paidCost, last.theoreticalApiCost);
  const next = {
    ...last,
    subscription,
    paidCost,
    difference: comparison.difference,
    ratio: comparison.ratio,
  };
  return [...periods.slice(0, -1), next];
}

/**
 * Paid AI actual cost for one project, plus the monthly comparison.
 * Theoretical API cost is reported and is not added on top of a ledger month.
 */
export function settleProjectAiCost(
  input: SettleProjectAiCostInput,
): SettledProjectAiCost {
  const theoreticalTotal = roundAiMoney(
    input.usage.reduce((sum, slice) => sum + slice.theoretical, 0),
  );

  if (input.ledgerEmpty) {
    const rows = new Map<string, MutablePeriod>();
    const ensure = (period: string) => {
      const existing = rows.get(period);
      if (existing) return existing;
      const created = emptyPeriod(period);
      rows.set(period, created);
      return created;
    };
    for (const system of input.systems) {
      if (system.costMode !== 'flat' && system.costMode !== 'mixed') continue;
      for (const share of flatFeeMonthShares({
        monthlyFee: system.flatMonthlyFee,
        startDate: input.startDate,
        endDate: input.endDate,
        today: input.today,
      })) {
        const row = ensure(share.period);
        row.fallbackFlat += share.amount;
        addSystemPaid(row, system.systemId, share.amount);
      }
    }
    for (const slice of input.usage) {
      const period = slice.period ?? input.today.slice(0, 7);
      const row = ensure(period);
      row.theoretical += slice.theoretical;
      if (slice.legacyToken !== 0) {
        row.legacyToken += slice.legacyToken;
        if (slice.systemId) addSystemPaid(row, slice.systemId, slice.legacyToken);
      }
    }
    let periods = [...rows.values()]
      .sort((a, b) => a.period.localeCompare(b.period))
      .map(finishPeriod);
    periods = lockPaidToLegacy(periods, input.legacyBillableCost);
    const systemPaid = new Map<string, number>();
    for (const system of input.systems) {
      systemPaid.set(system.systemId, system.legacyBillable);
    }
    return {
      aiPaidAc: roundAiMoney(input.legacyBillableCost),
      aiTheoreticalApiCost: theoreticalTotal,
      periods,
      systemPaid: [...systemPaid.entries()].map(([systemId, amount]) => ({
        systemId,
        amount: roundAiMoney(amount),
      })),
    };
  }

  const rows = new Map<string, MutablePeriod>();
  const ensure = (period: string) => {
    const existing = rows.get(period);
    if (existing) return existing;
    const created = emptyPeriod(period);
    rows.set(period, created);
    return created;
  };

  for (const share of input.shares) {
    if (!share.covered) continue;
    const row = ensure(share.period);
    if (share.aiSystemId == null) {
      row.workspaceCovered = true;
      distributeWorkspaceShare(
        row,
        share.amount,
        {
          subscription: share.subscription,
          planChange: share.planChange,
          onDemand: share.onDemand,
        },
        input.systems,
        input.usage,
      );
    } else {
      row.coveredSystems.add(share.aiSystemId);
      row.subscription += share.subscription;
      row.planChange += share.planChange;
      row.onDemand += share.onDemand;
      addSystemPaid(row, share.aiSystemId, share.amount);
    }
  }

  for (const system of input.systems) {
    if (system.costMode !== 'flat' && system.costMode !== 'mixed') continue;
    for (const share of flatFeeMonthShares({
      monthlyFee: system.flatMonthlyFee,
      startDate: input.startDate,
      endDate: input.endDate,
      today: input.today,
    })) {
      const row = ensure(share.period);
      if (periodCovered(row, system.systemId)) continue;
      row.fallbackFlat += share.amount;
      addSystemPaid(row, system.systemId, share.amount);
    }
  }

  for (const slice of input.usage) {
    if (slice.period == null) {
      continue;
    }
    const row = ensure(slice.period);
    row.theoretical += slice.theoretical;
    if (slice.legacyToken === 0) continue;
    if (periodCovered(row, slice.systemId)) continue;
    row.legacyToken += slice.legacyToken;
    if (slice.systemId) addSystemPaid(row, slice.systemId, slice.legacyToken);
  }

  for (const slice of input.usage) {
    if (slice.period != null) continue;
    if (rows.size === 0) {
      const row = ensure(input.today.slice(0, 7));
      row.theoretical += slice.theoretical;
    } else {
      const first = [...rows.values()].sort((a, b) =>
        a.period.localeCompare(b.period),
      )[0]!;
      first.theoretical += slice.theoretical;
    }
  }

  const periods = [...rows.values()]
    .sort((a, b) => a.period.localeCompare(b.period))
    .map(finishPeriod);

  const systemTotals = new Map<string, number>();
  for (const system of input.systems) systemTotals.set(system.systemId, 0);
  for (const row of rows.values()) {
    for (const [systemId, amount] of row.systemPaid) {
      systemTotals.set(systemId, (systemTotals.get(systemId) ?? 0) + amount);
    }
  }

  const aiPaidAc = roundAiMoney(
    periods.reduce((sum, period) => sum + period.paidCost, 0),
  );

  return {
    aiPaidAc,
    aiTheoreticalApiCost: theoreticalTotal,
    periods,
    systemPaid: [...systemTotals.entries()].map(([systemId, amount]) => ({
      systemId,
      amount: roundAiMoney(amount),
    })),
  };
}

export function currentAiBillingPeriod(now = new Date()): string {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  return `${year}-${String(month).padStart(2, '0')}`;
}

/** Move a YYYY-MM period by whole months. */
export function shiftAiBillingPeriod(period: string, deltaMonths: number): string {
  const parsed = assertAiBillingPeriod(period);
  const year = Number(parsed.slice(0, 4));
  const month = Number(parsed.slice(5, 7));
  const index = year * 12 + (month - 1) + deltaMonths;
  const nextYear = Math.floor(index / 12);
  const nextMonth = index - nextYear * 12 + 1;
  return `${String(nextYear).padStart(4, '0')}-${String(nextMonth).padStart(2, '0')}`;
}

/** Last 12 calendar months, including the current UTC month. */
export function defaultAiBillingWindow(now = new Date()): { from: string; to: string } {
  const to = currentAiBillingPeriod(now);
  return { from: shiftAiBillingPeriod(to, -11), to };
}

export function resolveAiBillingWindow(
  input: { from?: string | null; to?: string | null },
  now = new Date(),
): { from: string; to: string } {
  const fallback = defaultAiBillingWindow(now);
  const from = input.from?.trim() ? assertAiBillingPeriod(input.from) : null;
  const to = input.to?.trim() ? assertAiBillingPeriod(input.to) : null;
  const resolved = {
    from: from ?? (to ? shiftAiBillingPeriod(to, -11) : fallback.from),
    to: to ?? (from && from > fallback.to ? from : fallback.to),
  };
  if (resolved.from > resolved.to) {
    throw new AppError({
      code: 'BILLING_PERIOD_INVALID',
      message: 'from must be on or before to',
      statusCode: 400,
    });
  }
  return resolved;
}

export function aiBillingPeriodInWindow(period: string, from: string, to: string): boolean {
  return period >= from && period <= to;
}

/** Inclusive month list, capped so a bad range cannot loop. */
export function listAiBillingPeriods(from: string, to: string): string[] {
  const start = assertAiBillingPeriod(from);
  const end = assertAiBillingPeriod(to);
  if (start > end) return [];
  const periods: string[] = [];
  let cursor = start;
  while (cursor <= end && periods.length < 240) {
    periods.push(cursor);
    cursor = shiftAiBillingPeriod(cursor, 1);
  }
  return periods;
}

export type PlatformAiCostEntryInput = {
  id: string;
  period: string;
  provider: string;
  plan: string | null;
  type: AiBillingEntryType;
  amount: number;
  currency: string;
  paidAt: string | null;
  note: string | null;
  externalRef: string | null;
  aiSystemId: string | null;
};

export type PlatformAiCostEntryFilter = {
  workspaceId?: string;
  provider?: string;
  type?: AiBillingEntryType;
  period?: string;
};

export type PlatformAiWorkspaceMonth = AiBillingMonthSummary & {
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
};

export type PlatformAiCostEntry = PlatformAiCostEntryInput & {
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
};

/**
 * Platform view of workspace AI Cost charts. Totals sum each workspace's own
 * monthly figures, and only within one currency.
 */
export function buildPlatformAiCost(input: {
  from: string;
  to: string;
  workspaces: ReadonlyArray<{
    workspaceId: string;
    name: string;
    slug: string;
    chart: readonly AiBillingMonthParts[];
    entries: readonly PlatformAiCostEntryInput[];
  }>;
  entryFilter?: PlatformAiCostEntryFilter;
}): {
  from: string;
  to: string;
  periods: string[];
  months: PlatformAiWorkspaceMonth[];
  totals: AiBillingMonthSummary[];
  entries: PlatformAiCostEntry[];
  providers: string[];
} {
  const from = assertAiBillingPeriod(input.from);
  const to = assertAiBillingPeriod(input.to);
  if (from > to) {
    throw new AppError({
      code: 'BILLING_PERIOD_INVALID',
      message: 'from must be on or before to',
      statusCode: 400,
    });
  }

  const months: PlatformAiWorkspaceMonth[] = [];
  const inWindow: AiBillingMonthSummary[] = [];
  for (const workspace of input.workspaces) {
    for (const point of workspace.chart) {
      if (!aiBillingPeriodInWindow(point.period, from, to)) continue;
      const summary = summarizeAiBillingMonth(point);
      inWindow.push(summary);
      months.push({
        workspaceId: workspace.workspaceId,
        workspaceName: workspace.name,
        workspaceSlug: workspace.slug,
        ...summary,
      });
    }
  }
  months.sort((a, b) => {
    const period = b.period.localeCompare(a.period);
    if (period !== 0) return period;
    const currency = a.currency.localeCompare(b.currency);
    if (currency !== 0) return currency;
    return (
      a.workspaceName.localeCompare(b.workspaceName) || a.workspaceId.localeCompare(b.workspaceId)
    );
  });

  const grouped = new Map<string, AiBillingMonthParts>();
  for (const point of inWindow) {
    const key = `${point.period}|${point.currency}`;
    const current = grouped.get(key) ?? {
      period: point.period,
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
    grouped.set(key, current);
  }
  const totals = [...grouped.values()]
    .map((row) => summarizeAiBillingMonth(row))
    .sort((a, b) => a.currency.localeCompare(b.currency) || b.period.localeCompare(a.period));

  const filter = input.entryFilter;
  const providerNeedle = filter?.provider?.trim().toLowerCase() ?? '';
  const entries: PlatformAiCostEntry[] = [];
  const providers = new Set<string>();
  for (const workspace of input.workspaces) {
    for (const entry of workspace.entries) {
      const months = aiBillingEntryMonthSlices(entry).map((slice) => slice.period);
      if (!months.some((period) => aiBillingPeriodInWindow(period, from, to))) {
        continue;
      }
      providers.add(entry.provider);
      if (filter?.workspaceId && filter.workspaceId !== workspace.workspaceId) {
        continue;
      }
      if (filter?.type && filter.type !== entry.type) continue;
      if (filter?.period && !months.includes(filter.period)) continue;
      if (providerNeedle && entry.provider.trim().toLowerCase() !== providerNeedle) {
        continue;
      }
      entries.push({
        ...entry,
        workspaceId: workspace.workspaceId,
        workspaceName: workspace.name,
        workspaceSlug: workspace.slug,
      });
    }
  }
  entries.sort((a, b) => {
    const period = b.period.localeCompare(a.period);
    if (period !== 0) return period;
    const name = a.workspaceName.localeCompare(b.workspaceName);
    if (name !== 0) return name;
    return a.id.localeCompare(b.id);
  });

  return {
    from,
    to,
    periods: listAiBillingPeriods(from, to),
    months,
    totals,
    entries,
    providers: [...providers].sort((a, b) => a.localeCompare(b)),
  };
}
