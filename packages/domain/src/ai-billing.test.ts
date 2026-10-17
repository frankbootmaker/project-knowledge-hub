import { describe, expect, it } from 'vitest';
import {
  allocateAiBillingPool,
  buildPlatformAiCost,
  defaultAiBillingWindow,
  flatFeeMonthShares,
  roundAiMoney,
  scaleAiBillingTypes,
  settleProjectAiCost,
  splitAiMoney,
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
});
