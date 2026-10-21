import { describe, expect, it } from 'vitest';
import { parseCursorUsageCsv } from './ai-usage-import.js';
import { roundAiMoney } from './ai-billing.js';
import {
  DEFAULT_AI_MODEL_PRICES,
  matchAiModelPrice,
  parseUsagePaidAmount,
  priceImportedUsage,
  taskSupersededByImport,
} from './ai-model-price.js';

const HEADER = [
  'Date',
  'Cloud Agent ID',
  'Automation ID',
  'Kind',
  'Model',
  'Max Mode',
  'Input (w/ Cache Write)',
  'Input (w/o Cache Write)',
  'Cache Read',
  'Output Tokens',
  'Total Tokens',
  'Cost',
].join(',');

/**
 * Small stand-in for the Bootmaker October 2026 import: composer cache write,
 * a claude sonnet mix, a numeric CSV cost, Included, and an unknown model.
 */
const FIXTURE = [
  HEADER,
  '"2026-10-18T12:00:00.000Z","bc-linked","","Included","composer-2.5","No","1000000","0","0","0","1000000","Included"',
  '"2026-10-02T08:00:00.000Z","","","","claude-4.5-sonnet","No","0","500000","1000000","100000","1600000",""',
  '"2026-10-03T08:00:00.000Z","","","","gpt-4o","No","0","0","0","1000000","1000000","2.50"',
  '"2026-10-04T08:00:00.000Z","","","","mystery-x","No","0","1000","0","0","1000","Included"',
].join('\n');

describe('AI model prices', () => {
  it('prefers a workspace row and a longer glob', () => {
    const prices = [
      ...DEFAULT_AI_MODEL_PRICES,
      {
        workspaceId: 'ws',
        model: 'composer-2.5',
        inputPerMillion: 9,
        cacheWritePerMillion: 9,
        cacheReadPerMillion: 9,
        outputPerMillion: 9,
        currency: 'USD',
        effectiveFrom: '2026-01-01',
      },
    ];
    expect(matchAiModelPrice('composer-2.5', '2026-10-18', prices)?.cacheWritePerMillion).toBe(9);
    expect(matchAiModelPrice('claude-4.5-sonnet', '2026-10-02', prices)?.model).toBe(
      'claude*sonnet*',
    );
    expect(matchAiModelPrice('gpt-4o-mini', '2026-10-02', prices)?.model).toBe('gpt*mini*');
    expect(matchAiModelPrice('composer-2.5', '2025-12-31', prices)).toBeNull();
  });

  it('prices the October fixture, flags unknown models, and keeps Included theoretical', () => {
    const parsed = parseCursorUsageCsv(FIXTURE);
    expect(parsed.errors).toEqual([]);
    const priced = priceImportedUsage(
      parsed.rows.map((row) => ({
        occurredOn: row.occurredAt.toISOString().slice(0, 10),
        model: row.model,
        tokensInput: row.tokensInput,
        tokensCacheWrite: row.tokensCacheWrite,
        tokensCache: row.tokensCache,
        tokensOutput: row.tokensOutput,
        cost: row.cost,
        linked: row.cloudAgentId === 'bc-linked',
        cloudAgentId: row.cloudAgentId,
      })),
      DEFAULT_AI_MODEL_PRICES,
    );
    const composer = priced.rows.find((row) => row.model === 'composer-2.5');
    expect(composer).toMatchObject({ theoretical: 1.25, paid: null, priced: true, linked: true });
    const sonnet = priced.rows.find((row) => row.model === 'claude-4.5-sonnet');
    expect(sonnet?.theoretical).toBe(3.3);
    expect(sonnet?.paid).toBeNull();
    const gpt = priced.rows.find((row) => row.model === 'gpt-4o');
    expect(gpt).toMatchObject({ theoretical: 10, paid: 2.5, linked: false });
    expect(priced.unpricedModels).toEqual([
      { model: 'mystery-x', rowCount: 1, tokensTotal: 1000 },
    ]);
    const october = priced.months.find((row) => row.period === '2026-10');
    expect(october).toMatchObject({
      currency: 'USD',
      linked: 1.25,
      unassigned: 13.3,
      total: roundAiMoney(1.25 + 3.3 + 10),
    });
  });

  it('treats Included as unpaid and lets imported agents win', () => {
    expect(parseUsagePaidAmount('Included')).toBeNull();
    expect(parseUsagePaidAmount('')).toBeNull();
    expect(parseUsagePaidAmount('$2.50')).toBe(2.5);
    expect(parseUsagePaidAmount('nope')).toBeNull();
    expect(taskSupersededByImport('bc-linked', new Set(['bc-linked']))).toBe(true);
    expect(taskSupersededByImport(null, new Set(['bc-linked']))).toBe(false);
    expect(taskSupersededByImport('other', new Set(['bc-linked']))).toBe(false);
  });
});
