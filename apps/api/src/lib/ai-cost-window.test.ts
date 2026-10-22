import { describe, expect, it } from 'vitest';
import { AppError, roundAiMoney } from '@project-knowledge-hub/domain';
import { presentWorkspaceAiCost } from './ai-cost-window.js';
import type { WorkspaceAiCostOverview } from './ai-billing.js';

const NOW = new Date('2026-10-18T12:00:00.000Z');

function overview(): WorkspaceAiCostOverview {
  return {
    reportingCurrency: 'USD',
    entries: [
      {
        id: 'entry-1',
        workspaceId: 'ws-1',
        aiSystemId: null,
        period: '2026-10',
        servicePeriodStart: '2026-10-06',
        servicePeriodEnd: '2026-11-06',
        provider: 'Cursor',
        plan: 'Bootmaker Ultimate',
        type: 'subscription',
        amount: 200,
        currency: 'USD',
        paidAt: null,
        note: null,
        externalRef: null,
        createdAt: NOW.toISOString(),
        updatedAt: NOW.toISOString(),
        convertedAmount: 200,
        convertedCurrency: 'USD',
        fxRate: 1,
        fxRateDate: '2026-10-06',
        fxSource: 'identity',
      },
    ],
    chart: [],
    originalChart: [],
    pools: [],
    theoreticalDays: [
      {
        date: '2026-10-19',
        currency: 'USD',
        amount: 1.25,
        linked: true,
        projectId: 'project-1',
        projectName: 'Hub',
      },
      {
        date: '2026-10-19',
        currency: 'USD',
        amount: 3.3,
        linked: false,
        projectId: null,
        projectName: null,
      },
    ],
    originalTheoreticalDays: [],
    unpricedModels: [{ model: 'mystery-x', rowCount: 1, tokensTotal: 1000 }],
  };
}

function paid(points: Array<{ paidCost: number }>): number {
  return roundAiMoney(points.reduce((sum, row) => sum + row.paidCost, 0));
}

describe('presentWorkspaceAiCost grains', () => {
  it('sums the same daily slices for a partial month, week, and day range', () => {
    const query = { from: '2026-10-06', to: '2026-11-05' };
    const month = presentWorkspaceAiCost(overview(), { ...query, grain: 'month' }, NOW);
    const week = presentWorkspaceAiCost(overview(), { ...query, grain: 'week' }, NOW);
    const day = presentWorkspaceAiCost(overview(), { ...query, grain: 'day' }, NOW);
    expect(day.grain).toBe('day');
    expect(day.chart).toHaveLength(31);
    expect(paid(month.chart)).toBe(200);
    expect(paid(week.chart)).toBe(200);
    expect(paid(day.chart)).toBe(200);
    expect(day.theoretical).toEqual([
      expect.objectContaining({ currency: 'USD', linked: 1.25, unassigned: 3.3, total: 4.55 }),
    ]);
    expect(day.unpricedModels).toEqual([
      expect.objectContaining({ model: 'mystery-x' }),
    ]);
    expect(day.chart.some((row) => row.period > '2026-10-18' && row.scheduled)).toBe(true);
  });

  it('keeps the monthly ledger when the window is whole months', () => {
    const base = overview();
    base.chart = [
      {
        period: '2026-10',
        currency: 'USD',
        subscription: 167.74,
        planChange: 0,
        onDemand: 0,
        paidCost: 167.74,
        theoreticalApiCost: 0,
        fxRate: 1,
        fxRateDate: '2026-10-06',
        fxSource: 'identity',
      },
      {
        period: '2026-11',
        currency: 'USD',
        subscription: 32.26,
        planChange: 0,
        onDemand: 0,
        paidCost: 32.26,
        theoreticalApiCost: 0,
        fxRate: 1,
        fxRateDate: '2026-10-06',
        fxSource: 'identity',
      },
    ];
    const presented = presentWorkspaceAiCost(
      base,
      { from: '2026-10', to: '2026-11', grain: 'month' },
      NOW,
    );
    const october = presented.chart.find((row) => row.period === '2026-10');
    const november = presented.chart.find((row) => row.period === '2026-11');
    expect(october?.subscription).toBe(167.74);
    expect(november?.subscription).toBe(32.26);
    expect(presented.monthly.find((row) => row.period === '2026-10')?.subscription).toBe(167.74);
  });

  it('switches a day view longer than 92 days to weeks', () => {
    const presented = presentWorkspaceAiCost(
      overview(),
      { from: '2026-01-01', to: '2026-06-01', grain: 'day' },
      NOW,
    );
    expect(presented.grain).toBe('week');
    expect(presented.grainAdjusted).toBe(true);
  });

  it('hides a future allocation month unless the window includes it (PRO-B-38)', () => {
    const base = overview();
    const share = (amount: number) => ({
      projectId: 'p1',
      name: 'Hub',
      slug: 'hub',
      tokens: 0,
      overridePercent: null,
      amount,
      method: 'equal' as const,
      originalAmount: amount,
      projectAmount: amount,
      projectCurrency: 'EUR',
      reportingAmount: amount,
      fxRate: 1,
      fxRateDate: '2026-10-06',
      fxSource: 'identity',
    });
    base.pools = [
      {
        period: '2026-10',
        currency: 'EUR',
        originalCurrency: 'EUR',
        aiSystemId: null,
        aiSystemName: null,
        paidTotal: 201.96,
        originalPaidTotal: 201.96,
        fxRate: 1,
        fxRateDate: '2026-10-06',
        fxSource: 'identity',
        projects: [share(28.85)],
      },
      {
        period: '2026-11',
        currency: 'EUR',
        originalCurrency: 'EUR',
        aiSystemId: null,
        aiSystemName: null,
        paidTotal: 28.63,
        originalPaidTotal: 28.63,
        fxRate: 1,
        fxRateDate: '2026-10-06',
        fxSource: 'identity',
        projects: [share(4.09)],
      },
    ];
    const onOctober = new Date('2026-10-22T12:00:00.000Z');
    const october = presentWorkspaceAiCost(base, {}, onOctober);
    expect(october.pools.map((pool) => pool.period)).toEqual(['2026-10']);
    expect(october.pools[0]?.scheduled).toBe(false);
    const explicit = presentWorkspaceAiCost(
      base,
      { from: '2026-10', to: '2026-11' },
      onOctober,
    );
    expect(explicit.pools.map((pool) => pool.period)).toEqual(['2026-10', '2026-11']);
    expect(explicit.pools[1]?.scheduled).toBe(true);
    const budapest = presentWorkspaceAiCost(
      base,
      { timeZone: 'Europe/Budapest' },
      new Date('2026-10-31T23:30:00.000Z'),
    );
    expect(budapest.to).toBe('2026-11');
    expect(budapest.pools.map((pool) => pool.period)).toEqual(['2026-10', '2026-11']);
    expect(budapest.pools.find((pool) => pool.period === '2026-11')?.scheduled).toBe(false);
  });

  it('rejects an impossible from or to before using the default window (PRO-B-36)', () => {
    expect(() => presentWorkspaceAiCost(overview(), { from: 'oct' }, NOW)).toThrow(AppError);
    expect(() => presentWorkspaceAiCost(overview(), { to: '2026-02-30' }, NOW)).toThrow(
      /to must be a real calendar date/,
    );
    expect(() => presentWorkspaceAiCost(overview(), { from: '2026-13' }, NOW)).toThrow(
      /from must be a real calendar date/,
    );
  });
});
