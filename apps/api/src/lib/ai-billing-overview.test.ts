import { describe, expect, it } from 'vitest';
import { roundAiMoney, type FxRate } from '@project-knowledge-hub/domain';
import { foldBillingSlices } from './ai-cost-fx.js';
import {
  overviewFromPaidContext,
  type WorkspacePaidAiContext,
} from './ai-billing.js';

const rates: FxRate[] = [
  { date: '2026-09-30', base: 'EUR', quote: 'USD', rate: 1.1, source: 'ecb' },
  { date: '2026-10-02', base: 'EUR', quote: 'USD', rate: 1.2, source: 'ecb' },
];

function context(overrides: Partial<WorkspacePaidAiContext>): WorkspacePaidAiContext {
  const folded = foldBillingSlices({
    reportingCurrency: 'EUR',
    rates,
    candidates: () => [],
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
        currency: 'EUR',
        type: 'on_demand',
        amount: 10,
        onDate: '2026-10-02',
      },
    ],
  });
  return {
    today: '2026-10-24',
    entryRows: [],
    pricedBillable: [],
    imported: {
      rows: [],
      agentIds: new Set(),
      allocationEvents: [],
      unpricedModels: [],
      months: [],
      prices: [],
    },
    fxBook: { reportingCurrency: 'EUR', rates },
    folded,
    openProjects: [],
    systemProjectId: new Map(),
    overrideRows: [],
    tokenSlices: [],
    assistantNames: new Map(),
    projectById: new Map(),
    taskUnpriced: [],
    ...overrides,
  } as WorkspacePaidAiContext;
}

describe('overviewFromPaidContext', () => {
  it('keeps paid totals equal to the folded ledger and adds theoretical on top', () => {
    const source = context({
      pricedBillable: [
        {
          period: '2026-10',
          onDate: '2026-10-02',
          rowAmount: 3,
          currency: 'EUR',
          projectId: 'eur-1',
        },
      ] as WorkspacePaidAiContext['pricedBillable'],
      projectById: new Map([
        ['eur-1', { id: 'eur-1', name: 'Euro 1', slug: 'euro-1', status: 'active', currency: 'EUR', archivedAt: null }],
      ]) as WorkspacePaidAiContext['projectById'],
    });
    const paid = roundAiMoney(
      source.folded.reportingChart.reduce(
        (sum, point) => sum + point.subscription + point.planChange + point.onDemand,
        0,
      ),
    );
    const overview = overviewFromPaidContext(source);

    expect(paid).toBe(roundAiMoney(54.55 + 10));
    expect(
      roundAiMoney(overview.chart.reduce((sum, point) => sum + point.paidCost, 0)),
    ).toBe(paid);
    expect(
      roundAiMoney(overview.chart.reduce((sum, point) => sum + point.theoreticalApiCost, 0)),
    ).toBe(3);
    const originalPaid = roundAiMoney(
      overview.originalChart.reduce((sum, point) => sum + point.paidCost, 0),
    );
    expect(originalPaid).toBe(70);
  });
});
