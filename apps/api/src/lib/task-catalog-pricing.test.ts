import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AI_MODEL_PRICES,
  planSystemRateCatalogMigration,
  taskSupersededByImport,
} from '@project-knowledge-hub/domain';
import {
  groupedCatalogCost,
  priceTaskUsagesFromCatalog,
  tokenCostForUsages,
  type AiTokenRates,
  type AiUsageForCost,
} from './project-budget.js';

const systemRates: AiTokenRates = {
  blendedPer1k: 1.25,
  inputPer1k: 2,
  outputPer1k: null,
  cachePer1k: null,
  cacheWritePer1k: 0.5,
  currency: 'EUR',
};

const usages: AiUsageForCost[] = [
  { tokensUsed: 200, tokensInput: null, tokensOutput: null, tokensCache: null },
  {
    tokensUsed: 160,
    tokensInput: 100,
    tokensOutput: 40,
    tokensCache: 10,
    tokensCacheWrite: 10,
  },
  { tokensUsed: 100, tokensInput: null, tokensOutput: null, tokensCache: null },
];

describe('catalog pricing matches migrated system rates', () => {
  const plan = planSystemRateCatalogMigration({
    systems: [
      {
        systemId: 'sys-1',
        workspaceId: 'ws-1',
        systemName: 'Cursor',
        projectCurrency: 'EUR',
        rates: {
          blendedPer1k: 1.25,
          inputPer1k: 2,
          outputPer1k: null,
          cachePer1k: null,
          cacheWritePer1k: 0.5,
          currency: 'EUR',
        },
        tasks: [{ model: 'claude-sonnet-4', tokens: 460, status: 'done' }],
      },
    ],
  });
  const prices = [...DEFAULT_AI_MODEL_PRICES, plan.rows[0]!.price];
  const rows = usages.map((usage) => ({
    usage,
    model: 'claude-sonnet-4',
    onDate: '2026-04-02',
    tokens: usage.tokensUsed ?? 0,
  }));
  const priced = priceTaskUsagesFromCatalog(rows, prices);

  it('keeps grouped legacy token cost and per-task theoretical cost', () => {
    const beforeGrouped = tokenCostForUsages(usages, systemRates);
    const beforePerTask = usages.reduce(
      (sum, usage) => sum + tokenCostForUsages([usage], systemRates),
      0,
    );
    expect(priced.groupedCost).toBe(beforeGrouped);
    expect(priced.rows.reduce((sum, row) => sum + row.rowAmount, 0)).toBe(beforePerTask);
    expect(priced.unpriced).toEqual([]);
    expect(priced.rows.every((row) => row.currency === 'EUR')).toBe(true);
    expect(groupedCatalogCost(priced.rows)).toBe(beforeGrouped);
  });

  it('lists an unmatched model instead of pricing it at zero', () => {
    const mystery = priceTaskUsagesFromCatalog(
      [
        {
          usage: { tokensUsed: 1000, tokensInput: null, tokensOutput: null, tokensCache: null },
          model: 'mystery-model',
          onDate: '2026-04-02',
          tokens: 1000,
        },
      ],
      DEFAULT_AI_MODEL_PRICES,
    );
    expect(mystery.groupedCost).toBe(0);
    expect(mystery.rows[0]?.rowAmount).toBe(0);
    expect(mystery.unpriced).toEqual([
      { model: 'mystery-model', rowCount: 1, tokensTotal: 1000 },
    ]);
  });

  it('does not price a task the import already replaced', () => {
    const covered = taskSupersededByImport('agent-9', new Set(['agent-9']));
    const billable = covered
      ? []
      : rows;
    const after = priceTaskUsagesFromCatalog(billable, prices);
    expect(after.unpriced).toEqual([]);
    expect(after.groupedCost).toBe(0);
  });
});
