import { describe, expect, it } from 'vitest';
import {
  entryMatchesBillingListFilter,
  monthPoolsFromBillingEntries,
} from './ai-billing.js';

describe('monthPoolsFromBillingEntries', () => {
  it('splits a multi-month entry and keeps an undated entry in its period', () => {
    const pools = monthPoolsFromBillingEntries([
      {
        period: '2026-10',
        aiSystemId: null,
        currency: 'EUR',
        type: 'subscription',
        amount: 31,
        servicePeriodStart: '2026-10-12',
        servicePeriodEnd: '2026-11-11',
      },
      {
        period: '2026-10',
        aiSystemId: null,
        currency: 'EUR',
        type: 'on_demand',
        amount: 10,
        servicePeriodStart: null,
        servicePeriodEnd: null,
      },
    ]);
    const october = pools.get('2026-10||EUR');
    const november = pools.get('2026-11||EUR');
    expect(october?.paidTotal).toBe(30);
    expect(october?.subscription).toBe(20);
    expect(october?.onDemand).toBe(10);
    expect(november?.paidTotal).toBe(11);
    expect(november?.subscription).toBe(11);
  });

  it('does not mix a system pool with the workspace-wide pool', () => {
    const pools = monthPoolsFromBillingEntries([
      {
        period: '2026-10',
        aiSystemId: 'sys-1',
        currency: 'EUR',
        type: 'subscription',
        amount: 31,
        servicePeriodStart: '2026-10-12',
        servicePeriodEnd: '2026-11-11',
      },
    ]);
    expect(pools.get('2026-10|sys-1|EUR')?.paidTotal).toBe(20);
    expect(pools.get('2026-11|sys-1|EUR')?.paidTotal).toBe(11);
    expect(pools.has('2026-10||EUR')).toBe(false);
  });
});

describe('entryMatchesBillingListFilter', () => {
  const entry = {
    period: '2026-10',
    aiSystemId: null,
    amount: 31,
    servicePeriodStart: '2026-10-12',
    servicePeriodEnd: '2026-11-11',
  };

  it('matches every month the entry contributes to', () => {
    expect(entryMatchesBillingListFilter(entry, { period: '2026-11' })).toBe(true);
    expect(entryMatchesBillingListFilter(entry, { period: '2026-10' })).toBe(true);
    expect(entryMatchesBillingListFilter(entry, { period: '2026-12' })).toBe(false);
  });

  it('filters by an overlapping service window', () => {
    expect(
      entryMatchesBillingListFilter(entry, {
        servicePeriodStart: '2026-11-01',
        servicePeriodEnd: '2026-11-30',
      }),
    ).toBe(true);
    expect(
      entryMatchesBillingListFilter(entry, { servicePeriodStart: '2026-12-01' }),
    ).toBe(false);
  });
});
