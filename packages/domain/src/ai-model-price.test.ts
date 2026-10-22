import { describe, expect, it } from 'vitest';
import { parseCursorUsageCsv } from './ai-usage-import.js';
import { roundAiMoney } from './ai-billing.js';
import {
  AI_MODEL_PRICE_SOURCE_GUIDE,
  DEFAULT_AI_MODEL_PRICES,
  aiModelPriceToolDescription,
  auditModelPriceMetadata,
  fallbackTokenRate,
  matchAiModelPrice,
  modelPriceScopeDenial,
  parseUsagePaidAmount,
  presentAiModelPrices,
  priceImportedUsage,
  taskSupersededByImport,
  validateAiModelPriceWrite,
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
        blendedPerMillion: 9,
        currency: 'USD',
        effectiveFrom: '2026-01-01',
      },
    ];
    expect(matchAiModelPrice('composer-2.5', '2026-10-18', prices)?.cacheWritePerMillion).toBe(9);
    expect(matchAiModelPrice('claude-4.5-sonnet', '2026-10-02', prices)?.model).toBe(
      '*claude*sonnet*',
    );
    expect(matchAiModelPrice('gpt-4o-mini', '2026-10-02', prices)?.model).toBe('*gpt*mini*');
    expect(matchAiModelPrice('composer-2.5', '2025-12-31', prices)).toBeNull();
  });

  it('prices Cursor-prefixed ids from the provider glob', () => {
    expect(matchAiModelPrice('cursor-grok-4.5-high', '2026-06-01', DEFAULT_AI_MODEL_PRICES)?.model).toBe(
      '*grok*',
    );
    expect(
      matchAiModelPrice('cursor-grok-4.5-high', '2026-06-01', DEFAULT_AI_MODEL_PRICES)
        ?.inputPerMillion,
    ).toBe(3);
    expect(
      matchAiModelPrice('cursor-claude-4.5-sonnet', '2026-06-01', DEFAULT_AI_MODEL_PRICES)?.model,
    ).toBe('*claude*sonnet*');
    expect(matchAiModelPrice('cursor-gpt-4o-mini', '2026-06-01', DEFAULT_AI_MODEL_PRICES)?.model).toBe(
      '*gpt*mini*',
    );
    expect(
      matchAiModelPrice('cursor-grok-4.5-high', '2026-06-01', [
        {
          workspaceId: null,
          model: 'grok*',
          inputPerMillion: 4,
          cacheWritePerMillion: 4,
          cacheReadPerMillion: 1,
          outputPerMillion: 16,
          blendedPerMillion: 4,
          currency: 'USD',
          effectiveFrom: '2026-01-01',
        },
      ])?.inputPerMillion,
    ).toBe(4);
  });

  it('prefers a workspace override, then specificity, and skips retired rows', () => {
    const globalGrok = {
      workspaceId: null,
      model: '*grok*',
      inputPerMillion: 3,
      cacheWritePerMillion: 3,
      cacheReadPerMillion: 1,
      outputPerMillion: 15,
      blendedPerMillion: 3,
      currency: 'USD',
      effectiveFrom: '2026-06-01',
    };
    const workspaceGrok = {
      ...globalGrok,
      workspaceId: 'ws',
      inputPerMillion: 9,
      effectiveFrom: '2026-01-01',
    };
    const broad = { ...workspaceGrok, model: '*', inputPerMillion: 99 };
    const sonnet = DEFAULT_AI_MODEL_PRICES.find((row) => row.model === '*claude*sonnet*');
    expect(sonnet).toBeTruthy();
    expect(matchAiModelPrice('cursor-grok-4.5-high', '2026-07-01', [globalGrok, workspaceGrok])
      ?.inputPerMillion).toBe(9);
    expect(matchAiModelPrice('cursor-grok-4.5-high', '2026-03-01', [
      { ...globalGrok, effectiveFrom: '2026-01-01' },
      { ...workspaceGrok, effectiveFrom: '2026-06-01' },
    ])?.inputPerMillion).toBe(3);
    expect(matchAiModelPrice('claude-4.5-sonnet', '2026-07-01', [broad, sonnet!])?.model).toBe(
      '*claude*sonnet*',
    );
    expect(matchAiModelPrice('cursor-grok-4.5-high', '2026-07-01', [
      globalGrok,
      { ...workspaceGrok, retiredAt: '2026-07-02T00:00:00.000Z' },
    ])?.inputPerMillion).toBe(3);
    const tieA = { ...globalGrok, model: 'ab*', effectiveFrom: '2026-01-01', inputPerMillion: 1 };
    const tieB = { ...globalGrok, model: 'a*b', effectiveFrom: '2026-01-01', inputPerMillion: 2 };
    const forward = matchAiModelPrice('ab', '2026-02-01', [tieA, tieB])?.model;
    const reverse = matchAiModelPrice('ab', '2026-02-01', [tieB, tieA])?.model;
    expect(forward).toBe(reverse);
    expect(forward).toBe('ab*');
  });

  it('marks inherited and overridden rows and shows blended fallback', () => {
    const views = presentAiModelPrices([
      ...DEFAULT_AI_MODEL_PRICES,
      {
        workspaceId: 'ws',
        model: '*grok*',
        inputPerMillion: 9,
        cacheWritePerMillion: 9,
        cacheReadPerMillion: 1,
        outputPerMillion: 9,
        blendedPerMillion: 9,
        currency: 'USD',
        effectiveFrom: '2026-01-01',
      },
    ]);
    const globalGrok = views.find((row) => row.model === '*grok*' && row.scope === 'global');
    const workspaceGrok = views.find((row) => row.scope === 'workspace');
    const globalSonnet = views.find((row) => row.model === '*claude*sonnet*');
    expect(globalGrok).toMatchObject({ overridden: true, inherited: false });
    expect(workspaceGrok).toMatchObject({ overridesGlobal: true, inherited: false });
    expect(globalSonnet).toMatchObject({ inherited: true, overridden: false, scope: 'global' });
    expect(fallbackTokenRate(null, 3)).toEqual({ amount: 3, inherited: true });
    expect(fallbackTokenRate(0, 3)).toEqual({ amount: 0, inherited: false });
    expect(fallbackTokenRate(null, null)).toEqual({ amount: null, inherited: false });
  });

  it('checks scope permissions and price fields', () => {
    expect(modelPriceScopeDenial('global', {
      active: true,
      isSystemAdmin: false,
      workspaceRole: 'workspace_admin',
    })).toMatch(/platform administrator/i);
    expect(modelPriceScopeDenial('global', {
      active: true,
      isSystemAdmin: true,
      workspaceRole: null,
    })).toBeNull();
    expect(modelPriceScopeDenial('workspace', {
      active: true,
      isSystemAdmin: false,
      workspaceRole: 'maintainer',
    })).toMatch(/workspace administrator/i);
    expect(modelPriceScopeDenial('workspace', {
      active: true,
      isSystemAdmin: false,
      workspaceRole: 'workspace_admin',
    })).toBeNull();
    expect(modelPriceScopeDenial('workspace', {
      active: false,
      isSystemAdmin: true,
      workspaceRole: 'workspace_admin',
    })).toMatch(/cannot change/i);
    expect(validateAiModelPriceWrite({
      model: '*grok*',
      inputPerMillion: 3,
      outputPerMillion: 15,
      cacheReadPerMillion: 0.75,
      cacheWritePerMillion: 3.75,
      blendedPerMillion: 3,
      currency: 'usd',
      effectiveFrom: '2026-02-31',
    }, { requireSourceNote: true }).ok).toBe(false);
    const valid = validateAiModelPriceWrite({
      model: 'cursor-grok-4.5-high',
      inputPerMillion: 3,
      outputPerMillion: 15,
      cacheReadPerMillion: 0.75,
      cacheWritePerMillion: 3.75,
      blendedPerMillion: 3,
      currency: 'usd',
      effectiveFrom: '2026-01-01',
      sourceNote: 'https://docs.x.ai/docs/models Bearer sk-secret12345678',
    }, { requireSourceNote: true });
    expect(valid.ok).toBe(true);
    if (valid.ok) {
      expect(valid.price.currency).toBe('USD');
      expect(auditModelPriceMetadata({
        scope: 'global',
        model: valid.price.model,
        effectiveFrom: valid.price.effectiveFrom,
        currency: valid.price.currency,
        sourceNote: valid.price.sourceNote,
        via: 'mcp',
      }).sourceNote).toBe('https://docs.x.ai/docs/models [redacted]');
    }
    expect(aiModelPriceToolDescription('upsert')).toContain(AI_MODEL_PRICE_SOURCE_GUIDE);
    for (const url of [
      'https://docs.anthropic.com/en/docs/about-claude/pricing',
      'https://developers.openai.com/api/docs/pricing',
      'https://ai.google.dev/gemini-api/docs/pricing',
      'https://docs.x.ai/docs/models',
      'https://cursor.com/docs/models',
    ]) {
      expect(AI_MODEL_PRICE_SOURCE_GUIDE).toContain(url);
    }
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
