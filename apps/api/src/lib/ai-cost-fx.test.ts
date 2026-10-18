import { describe, expect, it } from 'vitest';
import { convertMoney, roundAiMoney, type FxRate } from '@project-knowledge-hub/domain';
import { addTheoreticalCost, foldBillingSlices, type SliceCandidate } from './ai-cost-fx.js';

/**
 * Bootmaker-shaped book. 1 October has no quote, so it falls back to 30 September.
 * 2 October uses the ECB dollar quote and the MNB forint quote.
 */
const rates: FxRate[] = [
  { date: '2026-09-30', base: 'EUR', quote: 'USD', rate: 1.1, source: 'ecb' },
  { date: '2026-09-30', base: 'EUR', quote: 'HUF', rate: 400, source: 'ecb' },
  { date: '2026-10-02', base: 'EUR', quote: 'USD', rate: 1.2, source: 'ecb' },
  { date: '2026-10-02', base: 'EUR', quote: 'HUF', rate: 410, source: 'mnb' },
];

const projects: SliceCandidate[] = [
  ...Array.from({ length: 6 }, (_, index) => ({
    projectId: `eur-${index + 1}`,
    name: `Euro ${index + 1}`,
    slug: `euro-${index + 1}`,
    currency: 'EUR',
    active: true,
    tokens: 0,
    overridePercent: null,
  })),
  {
    projectId: 'huf-1',
    name: 'Forint 1',
    slug: 'forint-1',
    currency: 'HUF',
    active: true,
    tokens: 0,
    overridePercent: null,
  },
];

function cents(amount: number): number {
  return Math.round(amount * 100);
}

describe('foldBillingSlices', () => {
  it('converts a USD pool into EUR and allocates it to EUR and HUF projects', () => {
    const folded = foldBillingSlices({
      reportingCurrency: 'EUR',
      rates,
      candidates: () => projects,
      slices: [
        {
          period: '2026-10',
          aiSystemId: null,
          currency: 'USD',
          type: 'subscription',
          amount: 60,
          onDate: '2026-10-01',
        },
      ],
    });

    expect(folded.reportingChart).toEqual([
      expect.objectContaining({
        period: '2026-10',
        currency: 'EUR',
        subscription: 54.55,
        fxRateDate: '2026-09-30',
        fxSource: 'ecb',
      }),
    ]);
    expect(folded.reportingChart[0]?.fxRate).toBeCloseTo(1 / 1.1, 8);
    expect(folded.originalChart).toEqual([
      expect.objectContaining({ currency: 'USD', subscription: 60, fxSource: null }),
    ]);

    const pool = folded.pools[0];
    expect(pool).toMatchObject({
      originalCurrency: 'USD',
      originalPaidTotal: 60,
      reportingCurrency: 'EUR',
      reportingPaidTotal: 54.55,
      converted: true,
      fxRateDate: '2026-09-30',
      fxSource: 'ecb',
    });

    const eurShares = (pool?.projects ?? []).filter((project) => project.projectCurrency === 'EUR');
    const hufShare = pool?.projects.find((project) => project.projectId === 'huf-1');
    expect(eurShares).toHaveLength(6);
    const eurOriginal = roundAiMoney(
      eurShares.reduce((sum, project) => sum + project.originalAmount, 0),
    );
    expect(eurOriginal).toBe(51.43);
    expect(hufShare?.originalAmount).toBe(8.57);
    expect(cents(eurOriginal) + cents(hufShare?.originalAmount ?? 0)).toBe(6000);

    const eurReporting = roundAiMoney(
      eurShares.reduce((sum, project) => sum + project.reportingAmount, 0),
    );
    expect(cents(eurReporting) + cents(hufShare?.reportingAmount ?? 0)).toBe(5455);

    expect(hufShare?.projectAmount).toBe(
      convertMoney(8.57, 'USD', 'HUF', '2026-10-01', rates).amount,
    );
    expect(hufShare).toMatchObject({
      projectCurrency: 'HUF',
      fxRateDate: '2026-09-30',
      fxSource: 'ecb',
    });
    const eurProjectSum = roundAiMoney(
      eurShares.reduce((sum, project) => sum + project.projectAmount, 0),
    );
    expect(eurProjectSum).toBe(convertMoney(51.43, 'USD', 'EUR', '2026-10-01', rates).amount);
    expect(eurProjectSum).toBe(46.75);

    const hufLedger = folded.sharesByProject.get('huf-1') ?? [];
    expect(hufLedger[0]?.amount).toBe(hufShare?.projectAmount);
    expect(hufLedger[0]?.conversions[0]).toMatchObject({
      originalAmount: 8.57,
      originalCurrency: 'USD',
      amount: hufShare?.projectAmount,
      currency: 'HUF',
      rateDate: '2026-09-30',
      source: 'ecb',
    });
  });

  it('adds a later USD entry in EUR and uses the MNB forint quote', () => {
    const folded = foldBillingSlices({
      reportingCurrency: 'EUR',
      rates,
      candidates: () => projects,
      slices: [
        {
          period: '2026-10',
          aiSystemId: null,
          currency: 'USD',
          type: 'subscription',
          amount: 60,
          onDate: '2026-10-01',
        },
        {
          period: '2026-10',
          aiSystemId: null,
          currency: 'USD',
          type: 'on_demand',
          amount: 200,
          onDate: '2026-10-02',
        },
      ],
    });
    const chart = folded.reportingChart.find((point) => point.currency === 'EUR');
    expect(chart).toMatchObject({ subscription: 54.55, onDemand: 166.67, fxSource: 'mixed' });
    expect(roundAiMoney((chart?.subscription ?? 0) + (chart?.onDemand ?? 0))).toBe(221.22);
    expect(folded.pools[0]).toMatchObject({
      originalPaidTotal: 260,
      reportingPaidTotal: 221.22,
      fxRate: null,
      fxSource: 'mixed',
    });
    const reportingCents = (folded.pools[0]?.projects ?? []).reduce(
      (sum, project) => sum + cents(project.reportingAmount),
      0,
    );
    expect(reportingCents).toBe(22122);

    const later = foldBillingSlices({
      reportingCurrency: 'EUR',
      rates,
      candidates: () => projects,
      slices: [
        {
          period: '2026-10',
          aiSystemId: null,
          currency: 'USD',
          type: 'on_demand',
          amount: 200,
          onDate: '2026-10-02',
        },
      ],
    });
    expect(later.pools[0]?.projects.find((project) => project.projectId === 'huf-1')).toMatchObject({
      fxSource: 'mnb',
      fxRateDate: '2026-10-02',
    });
  });

  it('does not book a foreign share when no earlier rate exists', () => {
    const folded = foldBillingSlices({
      reportingCurrency: 'EUR',
      rates: [],
      candidates: () => projects,
      slices: [
        {
          period: '2026-10',
          aiSystemId: null,
          currency: 'USD',
          type: 'subscription',
          amount: 60,
          onDate: '2026-10-01',
        },
      ],
    });
    expect(folded.reportingChart).toEqual([
      expect.objectContaining({ currency: 'USD', subscription: 60, fxSource: null }),
    ]);
    expect(folded.pools[0]).toMatchObject({
      converted: false,
      reportingPaidTotal: 0,
      fxSource: null,
    });
    expect(folded.sharesByProject.size).toBe(0);
    expect(folded.pools[0]?.projects.every((project) => project.projectAmount === 0)).toBe(true);
  });
});

describe('addTheoreticalCost', () => {
  it('converts theoretical usage on its own date and records the rate', () => {
    const { chart, conversion } = addTheoreticalCost([], {
      period: '2026-10',
      amount: 11,
      currency: 'USD',
      reportingCurrency: 'EUR',
      onDate: '2026-10-01',
      rates,
    });
    expect(conversion).toMatchObject({
      originalAmount: 11,
      originalCurrency: 'USD',
      currency: 'EUR',
      rateDate: '2026-09-30',
      source: 'ecb',
    });
    expect(chart[0]).toMatchObject({
      currency: 'EUR',
      theoretical: conversion.amount,
      fxRateDate: '2026-09-30',
      fxSource: 'ecb',
    });
  });
});
