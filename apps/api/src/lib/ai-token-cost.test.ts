import { describe, expect, it } from 'vitest';
import { mergeAiUsage, tokenCountSchema } from '@project-knowledge-hub/domain';
import {
  billAiAssistantUsage,
  tokenCostForUsages,
} from './project-budget.js';

const grokRates = {
  blendedPer1k: 0.004,
  inputPer1k: 0.002,
  outputPer1k: 0.006,
  cachePer1k: 0.0005,
};

describe('AI token cost modes', () => {
  it('bills api-only usage and ignores the flat fee', () => {
    const billed = billAiAssistantUsage({
      costMode: 'api',
      flatMonthlyFee: 20,
      rates: grokRates,
      usages: [{ tokensUsed: 1_000_000, tokensInput: null, tokensOutput: null, tokensCache: null }],
      startDate: null,
      endDate: null,
    });
    expect(billed.flatAccruedCost).toBe(0);
    expect(billed.tokenCost).toBe(4);
    expect(billed.billableCost).toBe(4);
    expect(billed.noteOnlyTokens).toBe(0);
  });

  it('bills flat-only the accrued fee and ignores tokens', () => {
    const billed = billAiAssistantUsage({
      costMode: 'flat',
      flatMonthlyFee: 20,
      rates: grokRates,
      usages: [
        {
          tokensUsed: 1_000_000,
          tokensInput: 800_000,
          tokensOutput: 150_000,
          tokensCache: 50_000,
        },
      ],
      startDate: null,
      endDate: null,
    });
    expect(billed.flatAccruedCost).toBe(20);
    expect(billed.tokenCost).toBe(0);
    expect(billed.billableCost).toBe(20);
  });

  it('bills mixed mode as accrued flat fee plus split rates', () => {
    const billed = billAiAssistantUsage({
      costMode: 'mixed',
      flatMonthlyFee: 20,
      rates: grokRates,
      usages: [
        {
          tokensUsed: 2_000_000,
          tokensInput: 1_000_000,
          tokensOutput: 500_000,
          tokensCache: 500_000,
        },
      ],
      startDate: null,
      endDate: null,
    });
    // 1M input * $0.002 + 0.5M output * $0.006 + 0.5M cache * $0.0005
    expect(billed.tokenCost).toBe(5.25);
    expect(billed.flatAccruedCost).toBe(20);
    expect(billed.billableCost).toBe(25.25);
  });

  it('falls back to the blended rate when a split rate is null', () => {
    const cost = tokenCostForUsages(
      [
        {
          tokensUsed: 3_000,
          tokensInput: 1_000,
          tokensOutput: 1_000,
          tokensCache: 1_000,
        },
      ],
      {
        blendedPer1k: 2,
        inputPer1k: null,
        outputPer1k: 6,
        cachePer1k: null,
      },
    );
    expect(cost).toBe(10);
  });

  it('keeps blended billing when only tokensUsed is stored', () => {
    const cost = tokenCostForUsages(
      [
        {
          tokensUsed: 1_000_000,
          tokensInput: null,
          tokensOutput: null,
          tokensCache: null,
        },
      ],
      grokRates,
    );
    expect(cost).toBe(4);
  });

  it('prices an explicit zero split rate as free', () => {
    const cost = tokenCostForUsages(
      [
        {
          tokensUsed: 1_000,
          tokensInput: 1_000,
          tokensOutput: null,
          tokensCache: null,
        },
      ],
      {
        blendedPer1k: 2,
        inputPer1k: 0,
        outputPer1k: null,
        cachePer1k: null,
      },
    );
    expect(cost).toBe(0);
  });

  it('records note_only tokens at zero cost', () => {
    const billed = billAiAssistantUsage({
      costMode: 'note_only',
      flatMonthlyFee: 20,
      rates: grokRates,
      usages: [
        {
          tokensUsed: 400,
          tokensInput: null,
          tokensOutput: null,
          tokensCache: null,
        },
      ],
      startDate: null,
      endDate: null,
    });
    expect(billed.billableCost).toBe(0);
    expect(billed.noteOnlyTokens).toBe(400);
  });
});

describe('AI usage breakdown merge', () => {
  it('sets tokensUsed to the sum when the total is omitted', () => {
    expect(
      mergeAiUsage(
        {
          tokensUsed: null,
          tokensInput: null,
          tokensOutput: null,
          tokensCache: null,
        },
        { tokensInput: 10, tokensOutput: 4, tokensCache: 1 },
      ),
    ).toEqual({
      tokensUsed: 15,
      tokensInput: 10,
      tokensOutput: 4,
      tokensCache: 1,
    });
  });

  it('clears a stored breakdown when only tokensUsed is written', () => {
    expect(
      mergeAiUsage(
        {
          tokensUsed: 15,
          tokensInput: 10,
          tokensOutput: 4,
          tokensCache: 1,
        },
        { tokensUsed: 9 },
      ),
    ).toEqual({
      tokensUsed: 9,
      tokensInput: null,
      tokensOutput: null,
      tokensCache: null,
    });
  });

  it('rejects a total that does not match the breakdown', () => {
    expect(() =>
      mergeAiUsage(
        {
          tokensUsed: null,
          tokensInput: null,
          tokensOutput: null,
          tokensCache: null,
        },
        { tokensUsed: 3, tokensInput: 2, tokensOutput: 2 },
      ),
    ).toThrowError(expect.objectContaining({ code: 'TOKEN_USAGE_MISMATCH' }));
  });

  it('rejects negative token counts', () => {
    expect(tokenCountSchema.safeParse(-1).success).toBe(false);
    expect(() =>
      mergeAiUsage(
        {
          tokensUsed: null,
          tokensInput: null,
          tokensOutput: null,
          tokensCache: null,
        },
        { tokensUsed: -5 },
      ),
    ).toThrowError(expect.objectContaining({ code: 'TOKEN_COUNT_INVALID' }));
  });
});
