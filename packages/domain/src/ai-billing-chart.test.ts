import { describe, expect, it } from 'vitest';
import {
  fillAiCostChart,
  fillPlatformAiCostMonths,
  formatAiBillingMonthLabel,
  resolveAiCostViewWindow,
} from './ai-billing-chart.js';

const NOW = new Date('2026-10-18T12:00:00.000Z');

describe('formatAiBillingMonthLabel', () => {
  it('uses an unambiguous month and year in EN, DE, and HU', () => {
    expect(formatAiBillingMonthLabel('2026-10', 'en')).toBe('Oct 2026');
    expect(formatAiBillingMonthLabel('2026-10', 'de')).toBe('Okt. 2026');
    expect(formatAiBillingMonthLabel('2026-10', 'hu')).toBe('2026. okt.');
  });
});

describe('resolveAiCostViewWindow', () => {
  it('defaults the workspace and admin views to the last 12 months', () => {
    expect(resolveAiCostViewWindow({}, NOW)).toEqual({
      from: '2025-11',
      to: '2026-10',
      range: 'last12',
    });
    expect(resolveAiCostViewWindow({ range: 'last12' }, NOW).range).toBe('last12');
  });

  it('uses the calendar year, all known months, or an explicit range', () => {
    expect(resolveAiCostViewWindow({ range: 'year' }, NOW)).toEqual({
      from: '2026-01',
      to: '2026-12',
      range: 'year',
    });
    expect(
      resolveAiCostViewWindow(
        { range: 'all', knownPeriods: ['2026-08', '2026-12', '2026-10'] },
        NOW,
      ),
    ).toEqual({ from: '2026-08', to: '2026-12', range: 'all' });
    expect(resolveAiCostViewWindow({ from: '2026-09', to: '2026-10' }, NOW)).toEqual({
      from: '2026-09',
      to: '2026-10',
      range: 'custom',
    });
  });
});

describe('fillAiCostChart', () => {
  const points = [
    {
      period: '2026-08',
      currency: 'USD',
      subscription: 20,
      planChange: 0,
      onDemand: 0,
      theoreticalApiCost: 5,
    },
    {
      period: '2026-10',
      currency: 'USD',
      subscription: 40,
      planChange: -10,
      onDemand: 5,
      theoreticalApiCost: 30,
    },
  ];

  it('fills gap months with zero and keeps a covered future month as scheduled', () => {
    const rows = fillAiCostChart(
      {
        points,
        entries: [
          {
            amount: 60,
            period: '2026-11',
            currency: 'USD',
            servicePeriodStart: '2026-11-01',
            servicePeriodEnd: '2026-11-30',
          },
        ],
        from: '2026-08',
        to: '2026-12',
      },
      NOW,
    );
    const usd = rows.filter((row) => row.currency === 'USD').map((row) => row.period);
    expect(usd).toEqual(['2026-08', '2026-09', '2026-10', '2026-11']);
    const september = rows.find((row) => row.period === '2026-09');
    expect(september).toMatchObject({
      subscription: 0,
      paidCost: 0,
      theoreticalApiCost: 0,
      difference: 0,
      ratio: null,
      scheduled: false,
    });
    const october = rows.find((row) => row.period === '2026-10');
    expect(october).toMatchObject({
      paidCost: 35,
      theoreticalApiCost: 30,
      difference: 5,
      ratio: 1.167,
      scheduled: false,
    });
    expect(rows.find((row) => row.period === '2026-11')?.scheduled).toBe(true);
    expect(rows.some((row) => row.period === '2026-12')).toBe(false);
  });

  it('drops a future month that only has theoretical usage', () => {
    const rows = fillAiCostChart(
      {
        points: [
          ...points,
          {
            period: '2026-12',
            currency: 'USD',
            subscription: 0,
            planChange: 0,
            onDemand: 0,
            theoreticalApiCost: 9,
          },
        ],
        from: '2026-10',
        to: '2026-12',
      },
      NOW,
    );
    expect(rows.map((row) => row.period)).toEqual(['2026-10']);
  });
});

describe('fillPlatformAiCostMonths', () => {
  it('aligns workspace gap rows with currency totals', () => {
    const filled = fillPlatformAiCostMonths(
      {
        from: '2026-09',
        to: '2026-10',
        months: [
          {
            workspaceId: 'alpha',
            workspaceName: 'Alpha',
            workspaceSlug: 'alpha',
            period: '2026-10',
            currency: 'USD',
            subscription: 40,
            planChange: 0,
            onDemand: 0,
            paidCost: 40,
            theoreticalApiCost: 10,
            difference: 30,
            ratio: 4,
          },
        ],
        entries: [],
      },
      NOW,
    );
    expect(filled.months.map((row) => row.period)).toEqual(['2026-10', '2026-09']);
    const september = filled.totals.find((row) => row.period === '2026-09');
    expect(september).toMatchObject({ paidCost: 0, difference: 0, scheduled: false });
    const october = filled.totals.find((row) => row.period === '2026-10');
    expect(october?.paidCost).toBe(40);
    expect(october?.difference).toBe(
      filled.months
        .filter((row) => row.period === '2026-10')
        .reduce((sum, row) => sum + row.difference, 0),
    );
  });
});
