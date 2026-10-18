import { describe, expect, it } from 'vitest';
import { buildPlatformAiCost, roundAiMoney } from '@project-knowledge-hub/domain';
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
        servicePeriodEnd: '2026-11-12',
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
        servicePeriodEnd: '2026-11-12',
      },
    ]);
    expect(pools.get('2026-10|sys-1|EUR')?.paidTotal).toBe(20);
    expect(pools.get('2026-11|sys-1|EUR')?.paidTotal).toBe(11);
    expect(pools.has('2026-10||EUR')).toBe(false);
  });

  it('shows a 12 Oct–12 Nov entry as 20/31 and 11/31 in the admin summary', () => {
    const pools = monthPoolsFromBillingEntries([
      {
        period: '2026-10',
        aiSystemId: null,
        currency: 'EUR',
        type: 'subscription',
        amount: 31,
        servicePeriodStart: '2026-10-12',
        servicePeriodEnd: '2026-11-12',
      },
    ]);
    const report = buildPlatformAiCost({
      from: '2026-10',
      to: '2026-11',
      workspaces: [
        {
          workspaceId: 'ws-alpha',
          name: 'Alpha',
          slug: 'alpha',
          chart: [...pools.values()].map((pool) => ({
            period: pool.period,
            currency: pool.currency,
            subscription: roundAiMoney(pool.subscription),
            planChange: roundAiMoney(pool.planChange),
            onDemand: roundAiMoney(pool.onDemand),
            theoreticalApiCost: 0,
          })),
          entries: [
            {
              id: 'span',
              period: '2026-10',
              servicePeriodStart: '2026-10-12',
              servicePeriodEnd: '2026-11-12',
              provider: 'Cursor',
              plan: null,
              type: 'subscription',
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
    });
    expect(report.totals.find((row) => row.period === '2026-10')).toMatchObject({
      paidCost: 20,
      subscription: 20,
    });
    expect(report.totals.find((row) => row.period === '2026-11')).toMatchObject({
      paidCost: 11,
      subscription: 11,
    });
    expect(report.entries.map((row) => row.id)).toEqual(['span']);
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
    expect(
      entryMatchesBillingListFilter(entry, { servicePeriodStart: '2026-11-11' }),
    ).toBe(false);
  });

  it('does not count the exclusive renewal date in a later month', () => {
    expect(
      entryMatchesBillingListFilter(
        {
          ...entry,
          servicePeriodStart: '2026-10-01',
          servicePeriodEnd: '2026-11-01',
        },
        { period: '2026-11' },
      ),
    ).toBe(false);
    expect(
      entryMatchesBillingListFilter(
        {
          ...entry,
          servicePeriodStart: '2026-10-01',
          servicePeriodEnd: '2026-11-01',
        },
        { period: '2026-10' },
      ),
    ).toBe(true);
  });
});
