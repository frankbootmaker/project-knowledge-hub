import { describe, expect, it } from 'vitest';
import {
  convertMoney,
  convertMoneyParts,
  lookupFxRate,
  paidConversionDate,
  splitSignedMoney,
  theoreticalUsageDate,
  usageConversionDate,
  type FxRate,
} from './fx.js';
import { roundAiMoney } from './ai-billing.js';

const rates: FxRate[] = [
  { date: '2026-09-30', base: 'EUR', quote: 'USD', rate: 1.1, source: 'ecb' },
  { date: '2026-09-30', base: 'EUR', quote: 'HUF', rate: 400, source: 'ecb' },
  { date: '2026-10-02', base: 'EUR', quote: 'USD', rate: 1.2, source: 'ecb' },
  { date: '2026-10-02', base: 'EUR', quote: 'HUF', rate: 400, source: 'ecb' },
  { date: '2026-10-02', base: 'EUR', quote: 'HUF', rate: 410, source: 'mnb' },
  { date: '2026-10-02', base: 'EUR', quote: 'USD', rate: 1.25, source: 'manual' },
];

describe('paid and usage conversion dates', () => {
  it('uses paid-at, then service start, then the period', () => {
    expect(
      paidConversionDate({
        paidAt: '2026-10-16T18:00:00.000Z',
        servicePeriodStart: '2026-10-01',
        period: '2026-10',
      }),
    ).toBe('2026-10-16');
    expect(
      paidConversionDate({
        paidAt: null,
        servicePeriodStart: '2026-10-12',
        period: '2026-10',
      }),
    ).toBe('2026-10-12');
    expect(
      paidConversionDate({
        paidAt: null,
        servicePeriodStart: null,
        period: '2026-10',
      }),
    ).toBe('2026-10-01');
  });

  it('uses usage time, then completion, then the last update', () => {
    expect(
      theoreticalUsageDate({
        usageOccurredAt: '2026-10-03T00:00:00.000Z',
        completedAt: '2026-10-04T00:00:00.000Z',
        updatedAt: '2026-10-05T00:00:00.000Z',
        period: '2026-10',
        fallback: '2026-10-18',
      }),
    ).toBe('2026-10-03');
    expect(
      theoreticalUsageDate({
        usageOccurredAt: null,
        completedAt: '2026-10-04T12:00:00.000Z',
        updatedAt: '2026-10-05T00:00:00.000Z',
        period: '2026-10',
        fallback: '2026-10-18',
      }),
    ).toBe('2026-10-04');
    expect(
      theoreticalUsageDate({
        usageOccurredAt: null,
        completedAt: null,
        updatedAt: '2026-10-05T00:00:00.000Z',
        period: '2026-10',
        fallback: '2026-10-18',
      }),
    ).toBe('2026-10-05');
  });

  it('uses the usage date, then the usage month', () => {
    expect(
      usageConversionDate({
        usageOccurredAt: '2026-10-03T00:00:00.000Z',
        period: '2026-10',
        fallback: '2026-10-18',
      }),
    ).toBe('2026-10-03');
    expect(
      usageConversionDate({
        usageOccurredAt: null,
        period: '2026-09',
        fallback: '2026-10-18',
      }),
    ).toBe('2026-09-01');
  });
});

describe('lookupFxRate', () => {
  it('uses the latest earlier day when the requested day is missing', () => {
    const found = lookupFxRate(rates, 'EUR', 'USD', '2026-10-01');
    expect(found).toMatchObject({ date: '2026-09-30', rate: 1.1, source: 'ecb' });
  });

  it('prefers a manual quote on that day, then MNB for HUF', () => {
    expect(lookupFxRate(rates, 'EUR', 'USD', '2026-10-02')).toMatchObject({
      source: 'manual',
      rate: 1.25,
    });
    expect(lookupFxRate(rates, 'EUR', 'HUF', '2026-10-02')).toMatchObject({
      source: 'mnb',
      rate: 410,
    });
  });
});

describe('convertMoney', () => {
  it('converts USD to EUR with the ECB quote and keeps the original amount', () => {
    const converted = convertMoney(60, 'USD', 'EUR', '2026-10-01', rates);
    expect(converted.originalAmount).toBe(60);
    expect(converted.originalCurrency).toBe('USD');
    expect(converted.currency).toBe('EUR');
    expect(converted.amount).toBe(54.55);
    expect(converted.rateDate).toBe('2026-09-30');
    expect(converted.source).toBe('ecb');
    expect(converted.rate).toBeCloseTo(1 / 1.1, 8);
  });

  it('converts USD to HUF through the euro legs', () => {
    const converted = convertMoney(60, 'USD', 'HUF', '2026-10-01', rates);
    expect(converted.amount).toBe(roundAiMoney((60 / 1.1) * 400));
    expect(converted.currency).toBe('HUF');
    expect(converted.rateDate).toBe('2026-09-30');
    expect(converted.source).toBe('ecb');
  });

  it('uses MNB when the HUF leg is quoted by MNB', () => {
    const converted = convertMoney(10, 'EUR', 'HUF', '2026-10-02', rates);
    expect(converted.amount).toBe(4100);
    expect(converted.source).toBe('mnb');
    expect(converted.rateDate).toBe('2026-10-02');
  });

  it('leaves the amount unconverted when no earlier rate exists', () => {
    const converted = convertMoney(10, 'USD', 'EUR', '2026-01-01', rates);
    expect(converted.amount).toBe(10);
    expect(converted.currency).toBe('USD');
    expect(converted.rate).toBeNull();
    expect(converted.source).toBeNull();
  });

  it('keeps the same currency as an identity rate', () => {
    const converted = convertMoney(12.5, 'EUR', 'EUR', '2026-10-01', rates);
    expect(converted).toMatchObject({
      amount: 12.5,
      currency: 'EUR',
      rate: 1,
      source: 'identity',
      rateDate: '2026-10-01',
    });
  });
});

describe('cent rounding', () => {
  it('makes converted parts sum to the converted total', () => {
    const parts = [0.01, 0.01, 0.01];
    const book: FxRate[] = [
      { date: '2026-10-01', base: 'EUR', quote: 'USD', rate: 1.5, source: 'ecb' },
    ];
    const { amounts, conversion } = convertMoneyParts(parts, 'USD', 'EUR', '2026-10-01', book);
    expect(conversion.amount).toBe(0.02);
    expect(roundAiMoney(amounts.reduce((sum, part) => sum + part, 0))).toBe(0.02);
    expect(amounts.reduce((sum, part) => sum + Math.round(part * 100), 0)).toBe(2);
  });

  it('keeps a credit and a charge summing to the converted net', () => {
    const { amounts, conversion } = convertMoneyParts(
      [100, -20],
      'USD',
      'EUR',
      '2026-10-01',
      rates,
    );
    expect(conversion.amount).toBe(roundAiMoney(80 / 1.1));
    expect(roundAiMoney(amounts.reduce((sum, part) => sum + part, 0))).toBe(conversion.amount);
  });

  it('splits a signed total so the cents add up', () => {
    const shares = splitSignedMoney(10, [1, 1, 1]);
    expect(shares.reduce((sum, part) => sum + part, 0)).toBe(10);
    expect(shares.map((part) => Math.round(part * 100)).reduce((sum, cents) => sum + cents, 0)).toBe(
      1000,
    );
  });
});
