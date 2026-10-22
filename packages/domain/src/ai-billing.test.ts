import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AppError } from './index.js';
import {
  allocateAiBillingPool,
  buildPlatformAiCost,
  defaultAiBillingWindow,
  flatFeeMonthShares,
  resolveAiBillingWindow,
  resolveBillingServiceWindow,
  roundAiMoney,
  scaleAiBillingTypes,
  settleProjectAiCost,
  splitAiMoney,
  splitBillingEntryByMonth,
  type AiBillingAllocationProject,
  type AiBillingMonthParts,
} from './ai-billing.js';

function project(
  projectId: string,
  patch: Partial<AiBillingAllocationProject> = {},
): AiBillingAllocationProject {
  return {
    projectId,
    tokens: 0,
    active: true,
    overridePercent: null,
    ...patch,
  };
}

function sumShares(
  shares: Array<{ amount: number }>,
): number {
  return roundAiMoney(shares.reduce((sum, share) => sum + share.amount, 0));
}

describe('resolveAiBillingWindow', () => {
  it('names the invalid bound instead of a generic period error (PRO-B-36)', () => {
    expect(() => resolveAiBillingWindow({ from: 'oct' })).toThrow(/from must be YYYY-MM/);
    expect(() => resolveAiBillingWindow({ to: '2026-13' })).toThrow(/to must be YYYY-MM/);
    expect(() => resolveAiBillingWindow({ from: '2026-02-30' })).toThrow(/from must be YYYY-MM/);
    try {
      resolveAiBillingWindow({ to: 'oct' });
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).statusCode).toBe(400);
    }
    expect(resolveAiBillingWindow({ from: '2026-01', to: '2026-03' })).toEqual({
      from: '2026-01',
      to: '2026-03',
    });
  });
});

describe('allocateAiBillingPool', () => {
  it('splits an upgrade plus on-demand month by token usage', () => {
    const paidTotal = 20 + 40 + 15;
    const shares = allocateAiBillingPool({
      paidTotal,
      projects: [
        project('a', { tokens: 1_000 }),
        project('b', { tokens: 3_000 }),
      ],
    });
    expect(shares).toEqual([
      { projectId: 'a', amount: 18.75, method: 'tokens' },
      { projectId: 'b', amount: 56.25, method: 'tokens' },
    ]);
    expect(sumShares(shares)).toBe(paidTotal);
  });

  it('applies a downgrade credit without allocating more than the net', () => {
    const paidTotal = 60 + -20 + 10;
    const shares = allocateAiBillingPool({
      paidTotal,
      projects: [
        project('a', { tokens: 75 }),
        project('b', { tokens: 25 }),
      ],
    });
    expect(shares.map((share) => share.amount)).toEqual([37.5, 12.5]);
    expect(sumShares(shares)).toBe(50);
    const types = scaleAiBillingTypes(37.5, {
      subscription: 60,
      planChange: -20,
      onDemand: 10,
    });
    expect(roundAiMoney(types.subscription + types.planChange + types.onDemand)).toBe(
      37.5,
    );
  });

  it('splits equally across active projects when the month has no tokens', () => {
    const shares = allocateAiBillingPool({
      paidTotal: 30,
      projects: [
        project('active-a'),
        project('completed', { active: false }),
        project('active-b'),
      ],
    });
    expect(shares).toEqual([
      { projectId: 'active-a', amount: 15, method: 'equal' },
      { projectId: 'completed', amount: 0, method: 'equal' },
      { projectId: 'active-b', amount: 15, method: 'equal' },
    ]);
    expect(sumShares(shares)).toBe(30);
  });

  it('gives a completed project its token share and nothing to idle projects', () => {
    const shares = allocateAiBillingPool({
      paidTotal: 40,
      projects: [
        project('idle'),
        project('done', { active: false, tokens: 8 }),
      ],
    });
    expect(shares.map((share) => share.amount)).toEqual([0, 40]);
  });

  it('applies manual percents and splits the remainder without double counting', () => {
    const shares = allocateAiBillingPool({
      paidTotal: 100,
      projects: [
        project('override', { overridePercent: 40 }),
        project('light', { tokens: 1 }),
        project('heavy', { tokens: 3 }),
      ],
    });
    expect(shares).toEqual([
      { projectId: 'override', amount: 40, method: 'override' },
      { projectId: 'light', amount: 15, method: 'tokens' },
      { projectId: 'heavy', amount: 45, method: 'tokens' },
    ]);
    expect(sumShares(shares)).toBe(100);
  });

  it('rejects overrides that sum past 100', () => {
    expect(() =>
      allocateAiBillingPool({
        paidTotal: 10,
        projects: [
          project('a', { overridePercent: 60 }),
          project('b', { overridePercent: 50 }),
        ],
      }),
    ).toThrowError(
      expect.objectContaining({ code: 'BILLING_ALLOCATION_INVALID' }),
    );
  });

  it('keeps a negative pool total inside the shares', () => {
    const shares = allocateAiBillingPool({
      paidTotal: -10,
      projects: [project('a', { tokens: 1 }), project('b', { tokens: 1 })],
    });
    expect(sumShares(shares)).toBe(-10);
    expect(shares.map((share) => share.amount)).toEqual([-5, -5]);
  });
});

describe('splitAiMoney', () => {
  it('gives leftover cents to the largest fraction', () => {
    expect(splitAiMoney(0.1, [1, 1, 1])).toEqual([0.04, 0.03, 0.03]);
    expect(sumShares(splitAiMoney(0.1, [1, 1, 1]).map((amount) => ({ amount })))).toBe(
      0.1,
    );
  });
});

describe('flatFeeMonthShares', () => {
  it('matches the day-fraction accrual used by the flat monthly fee', () => {
    const shares = flatFeeMonthShares({
      monthlyFee: 60,
      startDate: '2026-01-15',
      endDate: '2026-03-31',
      today: '2026-03-10',
    });
    const days = 17 + 28 + 10;
    const sum = shares.reduce((total, share) => total + share.amount, 0);
    expect(sum).toBeCloseTo((60 * days) / 30.437, 8);
    expect(shares.map((share) => share.period)).toEqual([
      '2026-01',
      '2026-02',
      '2026-03',
    ]);
  });

  it('returns one full month when the project has no window', () => {
    expect(
      flatFeeMonthShares({
        monthlyFee: 20,
        startDate: null,
        endDate: null,
        today: '2026-10-17',
      }),
    ).toEqual([{ period: '2026-10', amount: 20 }]);
  });
});

describe('settleProjectAiCost', () => {
  const systems = [
    {
      systemId: 'cursor',
      costMode: 'mixed' as const,
      flatMonthlyFee: 20,
      legacyBillable: 25.25,
    },
  ];

  it('keeps the legacy bill when the ledger is empty', () => {
    const settled = settleProjectAiCost({
      today: '2026-10-17',
      startDate: null,
      endDate: null,
      systems,
      legacyBillableCost: 25.25,
      ledgerEmpty: true,
      shares: [],
      usage: [
        {
          period: '2026-10',
          systemId: 'cursor',
          theoretical: 5.25,
          legacyToken: 5.25,
          tokens: 2_000_000,
        },
      ],
    });
    expect(settled.aiPaidAc).toBe(25.25);
    expect(settled.aiTheoreticalApiCost).toBe(5.25);
    expect(settled.periods.reduce((sum, period) => sum + period.paidCost, 0)).toBe(
      25.25,
    );
    expect(settled.systemPaid).toEqual([
      { systemId: 'cursor', amount: 25.25 },
    ]);
    expect(settled.periods[0]?.source).toBe('fallback');
  });

  it('replaces a covered month with the allocated paid cost', () => {
    const settled = settleProjectAiCost({
      today: '2026-10-17',
      startDate: '2026-10-01',
      endDate: '2026-11-30',
      systems,
      legacyBillableCost: 40,
      ledgerEmpty: false,
      shares: [
        {
          period: '2026-10',
          aiSystemId: null,
          amount: 75,
          subscription: 20,
          planChange: 40,
          onDemand: 15,
          covered: true,
        },
      ],
      usage: [
        {
          period: '2026-10',
          systemId: 'cursor',
          theoretical: 12,
          legacyToken: 12,
          tokens: 1_000,
        },
        {
          period: '2026-11',
          systemId: 'cursor',
          theoretical: 4,
          legacyToken: 4,
          tokens: 400,
        },
      ],
    });
    const october = settled.periods.find((period) => period.period === '2026-10');
    const november = settled.periods.find((period) => period.period === '2026-11');
    expect(october).toMatchObject({
      paidCost: 75,
      subscription: 20,
      planChange: 40,
      onDemand: 15,
      legacyToken: 0,
      theoreticalApiCost: 12,
      difference: 63,
      source: 'ledger',
    });
    expect(october?.ratio).toBeCloseTo(75 / 12, 3);
    expect(november?.source).toBe('fallback');
    expect(november?.legacyToken).toBe(4);
    expect(november?.theoreticalApiCost).toBe(4);
    expect(settled.aiTheoreticalApiCost).toBe(16);
    expect(settled.aiPaidAc).toBe(
      roundAiMoney((october?.paidCost ?? 0) + (november?.paidCost ?? 0)),
    );
  });

  it('does not add the flat fee on top of a ledger month', () => {
    const left = settleProjectAiCost({
      today: '2026-10-31',
      startDate: '2026-10-01',
      endDate: '2026-10-31',
      systems: [
        {
          systemId: 'cursor',
          costMode: 'flat',
          flatMonthlyFee: 20,
          legacyBillable: 20,
        },
      ],
      legacyBillableCost: 20,
      ledgerEmpty: false,
      shares: [
        {
          period: '2026-10',
          aiSystemId: null,
          amount: 11,
          subscription: 11,
          planChange: 0,
          onDemand: 0,
          covered: true,
        },
      ],
      usage: [],
    });
    const right = settleProjectAiCost({
      today: '2026-10-31',
      startDate: '2026-10-01',
      endDate: '2026-10-31',
      systems: [
        {
          systemId: 'cursor',
          costMode: 'flat',
          flatMonthlyFee: 20,
          legacyBillable: 20,
        },
      ],
      legacyBillableCost: 20,
      ledgerEmpty: false,
      shares: [
        {
          period: '2026-10',
          aiSystemId: null,
          amount: 9,
          subscription: 9,
          planChange: 0,
          onDemand: 0,
          covered: true,
        },
      ],
      usage: [],
    });
    expect(roundAiMoney(left.aiPaidAc + right.aiPaidAc)).toBe(20);
  });
});

describe('buildPlatformAiCost', () => {
  const now = new Date('2026-10-17T12:00:00.000Z');

  function point(
    period: string,
    currency: string,
    patch: Partial<AiBillingMonthParts> = {},
  ): AiBillingMonthParts {
    return {
      period,
      currency,
      subscription: 0,
      planChange: 0,
      onDemand: 0,
      theoreticalApiCost: 0,
      ...patch,
    };
  }

  it('defaults to the last 12 UTC months', () => {
    expect(defaultAiBillingWindow(now)).toEqual({ from: '2025-11', to: '2026-10' });
  });

  it('sums each workspace month per currency, including a plan-change credit', () => {
    const alpha = {
      workspaceId: 'ws-alpha',
      name: 'Alpha',
      slug: 'alpha',
      chart: [
        point('2026-10', 'EUR', {
          subscription: 100,
          planChange: -20,
          onDemand: 10,
          theoreticalApiCost: 40,
        }),
        point('2026-10', 'USD', {
          subscription: 5,
          theoreticalApiCost: 2,
        }),
        point('2026-08', 'EUR', { subscription: 999 }),
      ],
      entries: [
        {
          id: 'e1',
          period: '2026-10',
          provider: 'Cursor',
          plan: 'Pro',
          type: 'subscription' as const,
          amount: 100,
          currency: 'EUR',
          paidAt: null,
          note: null,
          externalRef: null,
          aiSystemId: null,
        },
        {
          id: 'e2',
          period: '2026-10',
          provider: 'Cursor',
          plan: null,
          type: 'plan_change' as const,
          amount: -20,
          currency: 'EUR',
          paidAt: null,
          note: 'downgrade credit',
          externalRef: null,
          aiSystemId: null,
        },
        {
          id: 'e3',
          period: '2026-08',
          provider: 'Cursor',
          plan: null,
          type: 'subscription' as const,
          amount: 999,
          currency: 'EUR',
          paidAt: null,
          note: null,
          externalRef: null,
          aiSystemId: null,
        },
      ],
    };
    const beta = {
      workspaceId: 'ws-beta',
      name: 'Beta',
      slug: 'beta',
      chart: [
        point('2026-10', 'EUR', {
          subscription: 40,
          onDemand: 8,
          theoreticalApiCost: 12,
        }),
      ],
      entries: [
        {
          id: 'e4',
          period: '2026-10',
          provider: 'OpenAI',
          plan: null,
          type: 'on_demand' as const,
          amount: 8,
          currency: 'EUR',
          paidAt: null,
          note: null,
          externalRef: null,
          aiSystemId: null,
        },
      ],
    };

    const report = buildPlatformAiCost({
      from: '2026-09',
      to: '2026-10',
      workspaces: [alpha, beta],
    });

    const eurMonths = report.months.filter((row) => row.currency === 'EUR');
    const eurTotal = report.totals.find(
      (row) => row.currency === 'EUR' && row.period === '2026-10',
    );
    const usdTotal = report.totals.find((row) => row.currency === 'USD');
    expect(eurMonths.map((row) => row.workspaceId).sort()).toEqual(['ws-alpha', 'ws-beta']);
    expect(report.months.some((row) => row.period === '2026-08')).toBe(false);
    expect(eurTotal).toMatchObject({
      subscription: 140,
      planChange: -20,
      onDemand: 18,
      paidCost: 138,
      theoreticalApiCost: 52,
      difference: 86,
    });
    expect(eurTotal?.paidCost).toBe(
      roundAiMoney(eurMonths.reduce((sum, row) => sum + row.paidCost, 0)),
    );
    expect(eurTotal?.theoreticalApiCost).toBe(
      roundAiMoney(eurMonths.reduce((sum, row) => sum + row.theoreticalApiCost, 0)),
    );
    expect(eurTotal?.difference).toBe(
      roundAiMoney(eurMonths.reduce((sum, row) => sum + row.difference, 0)),
    );
    expect(eurTotal?.planChange).toBe(
      roundAiMoney(eurMonths.reduce((sum, row) => sum + row.planChange, 0)),
    );
    expect(usdTotal).toMatchObject({
      paidCost: 5,
      theoreticalApiCost: 2,
      difference: 3,
    });
    expect(usdTotal?.paidCost).not.toBe(eurTotal?.paidCost);
    expect(report.totals.some((row) => row.currency === 'EUR+USD')).toBe(false);
    expect(eurTotal?.ratio).toBeCloseTo(138 / 52, 3);
    const ratioSum = eurMonths.reduce((sum, row) => sum + (row.ratio ?? 0), 0);
    expect(eurTotal?.ratio).not.toBeCloseTo(ratioSum, 2);

    const credits = buildPlatformAiCost({
      from: '2026-09',
      to: '2026-10',
      workspaces: [alpha, beta],
      entryFilter: {
        workspaceId: 'ws-alpha',
        provider: 'cursor',
        type: 'plan_change',
        period: '2026-10',
      },
    });
    expect(credits.entries.map((row) => row.id)).toEqual(['e2']);
    expect(credits.entries[0]?.workspaceSlug).toBe('alpha');
    expect(credits.providers).toEqual(['Cursor', 'OpenAI']);
  });

  it('shows a 12 Oct–12 Nov entry as 20/31 and 11/31 in the admin summary', () => {
    const slices = splitBillingEntryByMonth({
      amount: 31,
      period: '2026-10',
      servicePeriodStart: '2026-10-12',
      servicePeriodEnd: '2026-11-12',
    });
    const report = buildPlatformAiCost({
      from: '2026-10',
      to: '2026-11',
      workspaces: [
        {
          workspaceId: 'ws-alpha',
          name: 'Alpha',
          slug: 'alpha',
          chart: slices.map((slice) =>
            point(slice.period, 'EUR', { subscription: slice.amount }),
          ),
          entries: [
            {
              id: 'span',
              period: '2026-10',
              servicePeriodStart: '2026-10-12',
              servicePeriodEnd: '2026-11-12',
              provider: 'Cursor',
              plan: null,
              type: 'subscription' as const,
              amount: 31,
              currency: 'EUR',
              paidAt: null,
              note: null,
              externalRef: null,
              aiSystemId: null,
            },
          ],
        },
      ],
      entryFilter: { period: '2026-11' },
    });
    const october = report.totals.find((row) => row.period === '2026-10');
    const november = report.totals.find((row) => row.period === '2026-11');
    expect(slices.map((slice) => [slice.period, slice.days, slice.amount])).toEqual([
      ['2026-10', 20, 20],
      ['2026-11', 11, 11],
    ]);
    expect(october).toMatchObject({ paidCost: 20, subscription: 20 });
    expect(november).toMatchObject({ paidCost: 11, subscription: 11 });
    expect(october?.paidCost).toBeCloseTo((20 / 31) * 31, 2);
    expect(november?.paidCost).toBeCloseTo((11 / 31) * 31, 2);
    expect(report.entries.map((row) => row.id)).toEqual(['span']);
  });
});

describe('splitBillingEntryByMonth', () => {
  it('keeps a same-month window in that month', () => {
    expect(
      splitBillingEntryByMonth({
        amount: 40,
        period: '2026-10',
        servicePeriodStart: '2026-10-12',
        servicePeriodEnd: '2026-10-20',
      }),
    ).toEqual([{ period: '2026-10', days: 8, amount: 40 }]);
  });

  it('splits 12 Oct–12 Nov by exclusive days (20/31 and 11/31)', () => {
    const slices = splitBillingEntryByMonth({
      amount: 31,
      period: '2026-10',
      servicePeriodStart: '2026-10-12',
      servicePeriodEnd: '2026-11-12',
    });
    expect(slices).toEqual([
      { period: '2026-10', days: 20, amount: 20 },
      { period: '2026-11', days: 11, amount: 11 },
    ]);
    expect(slices.reduce((sum, slice) => sum + slice.amount, 0)).toBe(31);
  });

  it('counts 29 February in a leap year and 28 otherwise', () => {
    const leap = splitBillingEntryByMonth({
      amount: 29,
      period: '2024-02',
      servicePeriodStart: '2024-02-01',
      servicePeriodEnd: '2024-03-01',
    });
    expect(leap).toEqual([{ period: '2024-02', days: 29, amount: 29 }]);
    const common = splitBillingEntryByMonth({
      amount: 28,
      period: '2023-02',
      servicePeriodStart: '2023-02-01',
      servicePeriodEnd: '2023-03-01',
    });
    expect(common).toEqual([{ period: '2023-02', days: 28, amount: 28 }]);
    const span = splitBillingEntryByMonth({
      amount: 3,
      period: '2024-02',
      servicePeriodStart: '2024-02-28',
      servicePeriodEnd: '2024-03-02',
    });
    expect(span.map((slice) => [slice.period, slice.days, slice.amount])).toEqual([
      ['2024-02', 2, 2],
      ['2024-03', 1, 1],
    ]);
    expect(roundAiMoney(span.reduce((sum, slice) => sum + slice.amount, 0))).toBe(3);
  });

  it('rounds to cents with the largest remainder so slices sum exactly', () => {
    const slices = splitBillingEntryByMonth({
      amount: 10,
      period: '2026-10',
      servicePeriodStart: '2026-10-12',
      servicePeriodEnd: '2026-11-12',
    });
    expect(slices.map((slice) => slice.amount)).toEqual([6.45, 3.55]);
    expect(roundAiMoney(slices.reduce((sum, slice) => sum + slice.amount, 0))).toBe(10);

    const thirds = splitBillingEntryByMonth({
      amount: 1,
      period: '2026-01',
      servicePeriodStart: '2026-01-31',
      servicePeriodEnd: '2026-02-03',
    });
    expect(thirds.map((slice) => slice.days)).toEqual([1, 2]);
    expect(thirds.map((slice) => slice.amount)).toEqual([0.33, 0.67]);
    expect(roundAiMoney(thirds.reduce((sum, slice) => sum + slice.amount, 0))).toBe(1);
  });

  it('puts a negative plan change on the same day weights', () => {
    expect(
      splitBillingEntryByMonth({
        amount: -31,
        period: '2026-10',
        servicePeriodStart: '2026-10-12',
        servicePeriodEnd: '2026-11-12',
      }).map((slice) => slice.amount),
    ).toEqual([-20, -11]);
  });

  it('splits 6 Oct–6 Nov as 26/31 and 5/31 (200 → 167.74 / 32.26)', () => {
    const slices = splitBillingEntryByMonth({
      amount: 200,
      period: '2026-10',
      servicePeriodStart: '2026-10-06',
      servicePeriodEnd: '2026-11-06',
    });
    expect(slices).toEqual([
      { period: '2026-10', days: 26, amount: 167.74 },
      { period: '2026-11', days: 5, amount: 32.26 },
    ]);
    expect(roundAiMoney(slices.reduce((sum, slice) => sum + slice.amount, 0))).toBe(200);
  });

  it('keeps 1 Oct–1 Nov entirely in October', () => {
    expect(
      splitBillingEntryByMonth({
        amount: 60,
        period: '2026-10',
        servicePeriodStart: '2026-10-01',
        servicePeriodEnd: '2026-11-01',
      }),
    ).toEqual([{ period: '2026-10', days: 31, amount: 60 }]);
  });

  it('keeps a five-day October window in October', () => {
    expect(
      splitBillingEntryByMonth({
        amount: 60,
        period: '2026-10',
        servicePeriodStart: '2026-10-01',
        servicePeriodEnd: '2026-10-06',
      }),
    ).toEqual([{ period: '2026-10', days: 5, amount: 60 }]);
  });

  it('sums cents exactly on uneven exclusive weights', () => {
    const slices = splitBillingEntryByMonth({
      amount: 10,
      period: '2026-10',
      servicePeriodStart: '2026-10-06',
      servicePeriodEnd: '2026-11-06',
    });
    expect(slices.map((slice) => [slice.days, slice.amount])).toEqual([
      [26, 8.39],
      [5, 1.61],
    ]);
    expect(roundAiMoney(slices.reduce((sum, slice) => sum + slice.amount, 0))).toBe(10);
  });

  it('keeps the whole amount in period when service dates are missing', () => {
    expect(
      splitBillingEntryByMonth({ amount: 15.5, period: '2026-04' }),
    ).toEqual([{ period: '2026-04', days: 30, amount: 15.5 }]);
    expect(
      splitBillingEntryByMonth({
        amount: 8,
        period: '2026-05',
        servicePeriodStart: '2026-05-01',
        servicePeriodEnd: null,
      }),
    ).toEqual([{ period: '2026-05', days: 31, amount: 8 }]);
  });
});

describe('resolveBillingServiceWindow', () => {
  it('derives period from the start date', () => {
    expect(
      resolveBillingServiceWindow({
        period: '2026-01',
        servicePeriodStart: '2026-10-12',
        servicePeriodEnd: '2026-11-11',
      }),
    ).toEqual({
      period: '2026-10',
      servicePeriodStart: '2026-10-12',
      servicePeriodEnd: '2026-11-11',
    });
  });

  it('keeps period when both dates are empty', () => {
    expect(
      resolveBillingServiceWindow({ period: '2026-05', servicePeriodStart: null }),
    ).toEqual({
      period: '2026-05',
      servicePeriodStart: null,
      servicePeriodEnd: null,
    });
  });

  it('rejects an end date before the start date', () => {
    expect(() =>
      resolveBillingServiceWindow({
        servicePeriodStart: '2026-11-11',
        servicePeriodEnd: '2026-10-12',
      }),
    ).toThrow(/servicePeriodEnd/);
  });

  it('rejects an end date equal to the start date', () => {
    expect(() =>
      resolveBillingServiceWindow({
        servicePeriodStart: '2026-10-06',
        servicePeriodEnd: '2026-10-06',
      }),
    ).toThrow(/must be after/);
  });

  it('rejects a single service date', () => {
    expect(() =>
      resolveBillingServiceWindow({
        period: '2026-10',
        servicePeriodStart: '2026-10-01',
      }),
    ).toThrow(/both be set/);
  });
});

describe('exclusive service-end migration (PRO-T-108)', () => {
  const migrationSql = readFileSync(
    new URL(
      '../../database/src/migrations/0071_ai_billing_exclusive_service_end.sql',
      import.meta.url,
    ),
    'utf8',
  );

  function addOneDay(ymd: string): string {
    const year = Number(ymd.slice(0, 4));
    const month = Number(ymd.slice(5, 7));
    const day = Number(ymd.slice(8, 10));
    const date = new Date(Date.UTC(year, month - 1, day + 1));
    const nextYear = date.getUTCFullYear();
    const nextMonth = String(date.getUTCMonth() + 1).padStart(2, '0');
    const nextDay = String(date.getUTCDate()).padStart(2, '0');
    return `${nextYear}-${nextMonth}-${nextDay}`;
  }

  function lastDayOfMonth(period: string): string {
    const year = Number(period.slice(0, 4));
    const month = Number(period.slice(5, 7));
    const day = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return `${period}-${String(day).padStart(2, '0')}`;
  }

  function firstOfNextMonth(period: string): string {
    return addOneDay(lastDayOfMonth(period));
  }

  /** Inclusive day counts, the semantics of a 0069 full-month backfill. */
  function inclusiveMonthDays(
    start: string,
    end: string,
  ): Array<{ period: string; days: number }> {
    const startYear = Number(start.slice(0, 4));
    const startMonth = Number(start.slice(5, 7));
    const startDay = Number(start.slice(8, 10));
    const endYear = Number(end.slice(0, 4));
    const endMonth = Number(end.slice(5, 7));
    const endDay = Number(end.slice(8, 10));
    const counts: Array<{ period: string; days: number }> = [];
    let year = startYear;
    let month = startMonth;
    while (year < endYear || (year === endYear && month <= endMonth)) {
      const period = `${year}-${String(month).padStart(2, '0')}`;
      const monthDays = new Date(Date.UTC(year, month, 0)).getUTCDate();
      const first = year === startYear && month === startMonth ? startDay : 1;
      const last = year === endYear && month === endMonth ? endDay : monthDays;
      const days = last - first + 1;
      if (days > 0) counts.push({ period, days });
      month += 1;
      if (month > 12) {
        month = 1;
        year += 1;
      }
    }
    return counts;
  }

  function monthAmounts(
    slices: ReadonlyArray<{ period: string; amount: number }>,
  ): Record<string, number> {
    return Object.fromEntries(slices.map((slice) => [slice.period, slice.amount]));
  }

  /**
   * 0069 wrote start = period-01 and end = the last day of that month.
   * 0071 moves only that end to the 1st of the next month. Same-day rows
   * move forward one day so end > start. Every other stored end stays.
   */
  function migratedEnd(start: string, end: string): string {
    const period = start.slice(0, 7);
    if (start === `${period}-01` && end === lastDayOfMonth(period)) {
      return firstOfNextMonth(period);
    }
    if (start === end) return addOneDay(end);
    return end;
  }

  it('shifts only the 0069 full-month predicate, plus same-day rows', () => {
    expect(migrationSql).toMatch(/0069/);
    expect(migrationSql).toMatch(/no separate marker/i);
    expect(migrationSql).toMatch(
      /"service_period_start" = \("period" \|\| '-01'\)::date/,
    );
    expect(migrationSql).toMatch(
      /\(\("period" \|\| '-01'\)::date \+ interval '1 month'\) - interval '1 day'/,
    );
    expect(migrationSql).toMatch(
      /"service_period_end" = \("service_period_start" \+ interval '1 month'\)::date/,
    );
    expect(migrationSql).toMatch(
      /"service_period_end" = "service_period_start"/,
    );
    expect(migrationSql).not.toMatch(
      /WHERE "service_period_end" IS NOT NULL;/,
    );
    expect(migrationSql).toMatch(
      /"service_period_end" > "service_period_start"/,
    );
  });

  it('keeps month totals for backfilled full-month rows', () => {
    for (const period of [
      '2023-02',
      '2024-02',
      '2026-04',
      '2026-10',
      '2026-12',
    ]) {
      const start = `${period}-01`;
      const inclusiveEnd = lastDayOfMonth(period);
      const exclusiveEnd = migratedEnd(start, inclusiveEnd);
      expect(exclusiveEnd).toBe(firstOfNextMonth(period));
      for (const amount of [60, 10.01, -15.5]) {
        const beforeDays = inclusiveMonthDays(start, inclusiveEnd);
        const beforeAmounts = splitAiMoney(
          amount,
          beforeDays.map((count) => count.days),
        );
        const before = monthAmounts(
          beforeDays.map((count, index) => ({
            period: count.period,
            amount: beforeAmounts[index] ?? 0,
          })),
        );
        const after = monthAmounts(
          splitBillingEntryByMonth({
            amount,
            period,
            servicePeriodStart: start,
            servicePeriodEnd: exclusiveEnd,
          }),
        );
        expect(after).toEqual(before);
        const sum = Object.values(after).reduce((total, value) => total + value, 0);
        expect(roundAiMoney(sum)).toBe(roundAiMoney(amount));
      }
    }
    expect(firstOfNextMonth('2026-10')).toBe('2026-11-01');
    expect(firstOfNextMonth('2024-02')).toBe('2024-03-01');
    expect(firstOfNextMonth('2026-12')).toBe('2027-01-01');
  });

  it('leaves a user-entered 6 Oct–6 Nov row unchanged at 167.74 / 32.26', () => {
    expect(migratedEnd('2026-10-06', '2026-11-06')).toBe('2026-11-06');
    expect(migratedEnd('2026-10-01', '2026-10-06')).toBe('2026-10-06');
    const slices = splitBillingEntryByMonth({
      amount: 200,
      period: '2026-10',
      servicePeriodStart: '2026-10-06',
      servicePeriodEnd: migratedEnd('2026-10-06', '2026-11-06'),
    });
    expect(slices).toEqual([
      { period: '2026-10', days: 26, amount: 167.74 },
      { period: '2026-11', days: 5, amount: 32.26 },
    ]);
    expect(roundAiMoney(slices.reduce((sum, slice) => sum + slice.amount, 0))).toBe(200);
  });

  it('moves only a same-day window forward one day', () => {
    expect(migratedEnd('2026-10-06', '2026-10-06')).toBe('2026-10-07');
    expect(migratedEnd('2026-10-31', '2026-10-31')).toBe('2026-11-01');
    const slices = splitBillingEntryByMonth({
      amount: 12,
      period: '2026-10',
      servicePeriodStart: '2026-10-31',
      servicePeriodEnd: migratedEnd('2026-10-31', '2026-10-31'),
    });
    expect(slices).toEqual([{ period: '2026-10', days: 1, amount: 12 }]);
  });
});
