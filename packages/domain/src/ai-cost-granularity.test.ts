import { describe, expect, it } from 'vitest';
import { roundAiMoney } from './ai-billing.js';
import {
  aggregateAiCostBuckets,
  formatAiCostDayLabel,
  paidDaysFromBillingEntries,
  resolveAiCostGrain,
  splitBillingEntryByDay,
} from './ai-cost-granularity.js';

const TODAY = '2026-10-18';

describe('splitBillingEntryByDay', () => {
  it('spreads Bootmaker Ultimate across 31 service days at 200/31', () => {
    const slices = splitBillingEntryByDay({
      amount: 200,
      period: '2026-10',
      servicePeriodStart: '2026-10-06',
      servicePeriodEnd: '2026-11-06',
    });
    expect(slices).toHaveLength(31);
    expect(slices[0]?.date).toBe('2026-10-06');
    expect(slices[30]?.date).toBe('2026-11-05');
    const perDay = 200 / 31;
    for (const slice of slices) {
      expect(Math.abs(slice.amount - perDay)).toBeLessThanOrEqual(0.01);
    }
    expect(roundAiMoney(slices.reduce((sum, slice) => sum + slice.amount, 0))).toBe(200);
    const october = slices
      .filter((slice) => slice.date.startsWith('2026-10'))
      .reduce((sum, slice) => sum + slice.amount, 0);
    const november = slices
      .filter((slice) => slice.date.startsWith('2026-11'))
      .reduce((sum, slice) => sum + slice.amount, 0);
    expect(roundAiMoney(october + november)).toBe(200);
    expect(slices.filter((slice) => slice.date.startsWith('2026-10'))).toHaveLength(26);
    expect(slices.filter((slice) => slice.date.startsWith('2026-11'))).toHaveLength(5);
  });
});

describe('aggregateAiCostBuckets', () => {
  const entry = {
    amount: 200,
    currency: 'USD',
    type: 'subscription' as const,
    period: '2026-10',
    servicePeriodStart: '2026-10-06',
    servicePeriodEnd: '2026-11-06',
  };

  it('keeps day, week, and month totals equal for the same range', () => {
    const days = paidDaysFromBillingEntries([entry]);
    const range = { fromDay: '2026-10-01', toDay: '2026-11-30', today: TODAY };
    const month = aggregateAiCostBuckets(days, { ...range, grain: 'month' });
    const week = aggregateAiCostBuckets(days, { ...range, grain: 'week' });
    const day = aggregateAiCostBuckets(days, { ...range, grain: 'day' });
    const paid = (rows: typeof month) =>
      roundAiMoney(rows.reduce((sum, row) => sum + row.paidCost, 0));
    expect(paid(month)).toBe(200);
    expect(paid(week)).toBe(200);
    expect(paid(day)).toBe(200);
    const firstDay = day.find((row) => row.period === '2026-10-06')?.subscription ?? 0;
    expect(Math.abs(firstDay - 200 / 31)).toBeLessThan(0.02);
    expect(day.find((row) => row.period === '2026-10-19')?.scheduled).toBe(true);
    expect(day.find((row) => row.period === '2026-10-06')?.scheduled).toBe(false);
    expect(day.some((row) => row.period === '2026-10-05' && row.subscription === 0)).toBe(true);
  });

  it('switches a long day view to weeks', () => {
    expect(resolveAiCostGrain('day', '2026-01-01', '2026-12-31')).toEqual({
      grain: 'week',
      adjusted: true,
    });
    expect(resolveAiCostGrain('day', '2026-10-01', '2026-10-31')).toEqual({
      grain: 'day',
      adjusted: false,
    });
  });
});

describe('formatAiCostDayLabel', () => {
  it('uses a short month and day in EN, DE, and HU', () => {
    expect(formatAiCostDayLabel('2026-10-19', 'en')).toBe('Oct 19');
    expect(formatAiCostDayLabel('2026-10-19', 'de')).toMatch(/19/);
    expect(formatAiCostDayLabel('2026-10-19', 'de').toLowerCase()).toMatch(/okt/);
    const hu = formatAiCostDayLabel('2026-10-19', 'hu');
    expect(hu).toMatch(/19/);
    expect(hu.toLowerCase()).toMatch(/okt/);
  });
});
