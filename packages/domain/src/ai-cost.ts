import { z } from 'zod';
import { AppError } from './index.js';

/** Postgres integer ceiling for token counters. */
export const MAX_TOKEN_COUNT = 2_147_483_647;

export const AI_COST_NOTES_MAX = 500;
export const AI_MODEL_ID_MAX = 80;
export const AI_PRICING_TIER_MAX = 32;

export const tokenCountSchema = z
  .number()
  .int()
  .min(0)
  .max(MAX_TOKEN_COUNT);

/** Calendar month tag stored for audit. It does not change fee accrual. */
export const aiBillingPeriodSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/);

export type AiUsageCounts = {
  tokensUsed: number | null;
  tokensInput: number | null;
  tokensOutput: number | null;
  tokensCache: number | null;
};

export type AiUsagePatch = {
  tokensUsed?: number | null;
  tokensInput?: number | null;
  tokensOutput?: number | null;
  tokensCache?: number | null;
};

const COUNT_FIELDS = [
  'tokensUsed',
  'tokensInput',
  'tokensOutput',
  'tokensCache',
] as const;

function assertTokenCount(
  value: number | null | undefined,
  field: string,
): void {
  if (value == null) return;
  const parsed = tokenCountSchema.safeParse(value);
  if (!parsed.success) {
    throw new AppError({
      code: 'TOKEN_COUNT_INVALID',
      message: `${field} must be a non-negative integer`,
      statusCode: 400,
    });
  }
}

function countOrNull(value: number | null | undefined): number | null {
  return value == null ? null : value;
}

export function usageHasTokenBreakdown(usage: {
  tokensInput?: number | null;
  tokensOutput?: number | null;
  tokensCache?: number | null;
}): boolean {
  return (
    usage.tokensInput != null ||
    usage.tokensOutput != null ||
    usage.tokensCache != null
  );
}

export function tokenBreakdownSum(usage: {
  tokensInput?: number | null;
  tokensOutput?: number | null;
  tokensCache?: number | null;
}): number {
  const sum =
    (usage.tokensInput ?? 0) +
    (usage.tokensOutput ?? 0) +
    (usage.tokensCache ?? 0);
  if (sum > MAX_TOKEN_COUNT) {
    throw new AppError({
      code: 'TOKEN_COUNT_INVALID',
      message: 'Token breakdown sum exceeds the maximum integer',
      statusCode: 400,
    });
  }
  return sum;
}

/**
 * Merge a usage write onto the stored counters.
 *
 * A breakdown (any of input/output/cache set) is billed with split rates.
 * `tokensUsed` becomes the sum when omitted or null. A provided total must
 * match that sum. A write that sets only `tokensUsed` clears the breakdown
 * so legacy clients keep blended-rate billing.
 */
export function mergeAiUsage(
  existing: AiUsageCounts,
  patch: AiUsagePatch,
): AiUsageCounts {
  for (const field of COUNT_FIELDS) {
    if (patch[field] !== undefined) assertTokenCount(patch[field], field);
  }

  const breakdownTouched =
    patch.tokensInput !== undefined ||
    patch.tokensOutput !== undefined ||
    patch.tokensCache !== undefined;
  const tokensUsedTouched = patch.tokensUsed !== undefined;

  const next: AiUsageCounts = {
    tokensUsed: tokensUsedTouched
      ? countOrNull(patch.tokensUsed)
      : countOrNull(existing.tokensUsed),
    tokensInput:
      patch.tokensInput !== undefined
        ? countOrNull(patch.tokensInput)
        : countOrNull(existing.tokensInput),
    tokensOutput:
      patch.tokensOutput !== undefined
        ? countOrNull(patch.tokensOutput)
        : countOrNull(existing.tokensOutput),
    tokensCache:
      patch.tokensCache !== undefined
        ? countOrNull(patch.tokensCache)
        : countOrNull(existing.tokensCache),
  };

  if (breakdownTouched && usageHasTokenBreakdown(next)) {
    const sum = tokenBreakdownSum(next);
    if (!tokensUsedTouched || patch.tokensUsed == null) {
      next.tokensUsed = sum;
    } else if (patch.tokensUsed !== sum) {
      throw new AppError({
        code: 'TOKEN_USAGE_MISMATCH',
        message:
          'tokensUsed must equal tokensInput + tokensOutput + tokensCache',
        statusCode: 400,
      });
    }
    return next;
  }

  if (!breakdownTouched && tokensUsedTouched) {
    next.tokensInput = null;
    next.tokensOutput = null;
    next.tokensCache = null;
  }

  return next;
}

/** Report calls must send a total or at least one breakdown counter. */
export function assertReportedAiUsage(input: AiUsagePatch): void {
  for (const field of COUNT_FIELDS) {
    if (input[field] !== undefined) assertTokenCount(input[field], field);
  }
  const hasBreakdown = usageHasTokenBreakdown({
    tokensInput: input.tokensInput,
    tokensOutput: input.tokensOutput,
    tokensCache: input.tokensCache,
  });
  if (input.tokensUsed == null && !hasBreakdown) {
    throw new AppError({
      code: 'TOKEN_USAGE_REQUIRED',
      message: 'Provide tokensUsed or a token breakdown',
      statusCode: 400,
    });
  }
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** ISO datetime or `YYYY-MM-DD` (UTC midnight). Empty clears the column. */
export function parseUsageOccurredAt(
  value: string | null | undefined,
): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value.trim() === '') return null;
  const trimmed = value.trim();
  const dateOnly = DATE_ONLY.exec(trimmed);
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (
      parsed.getUTCFullYear() !== year ||
      parsed.getUTCMonth() !== month - 1 ||
      parsed.getUTCDate() !== day
    ) {
      throw new AppError({
        code: 'USAGE_OCCURRED_AT_INVALID',
        message: 'usageOccurredAt must be a calendar date or ISO datetime',
        statusCode: 400,
      });
    }
    return parsed;
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new AppError({
      code: 'USAGE_OCCURRED_AT_INVALID',
      message: 'usageOccurredAt must be a calendar date or ISO datetime',
      statusCode: 400,
    });
  }
  return parsed;
}

export function parseBillingPeriod(
  value: string | null | undefined,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value.trim() === '') return null;
  const parsed = aiBillingPeriodSchema.safeParse(value.trim());
  if (!parsed.success) {
    throw new AppError({
      code: 'BILLING_PERIOD_INVALID',
      message: 'billingPeriod must be YYYY-MM',
      statusCode: 400,
    });
  }
  return parsed.data;
}

function parseShortLabel(
  value: string | null | undefined,
  field: string,
  max: number,
  code: string,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value.trim() === '') return null;
  const trimmed = value.trim();
  if (trimmed.length > max) {
    throw new AppError({
      code,
      message: `${field} must be at most ${max} characters`,
      statusCode: 400,
    });
  }
  return trimmed;
}

export function parseAiModelId(
  value: string | null | undefined,
): string | null | undefined {
  return parseShortLabel(
    value,
    'modelId',
    AI_MODEL_ID_MAX,
    'AI_MODEL_ID_INVALID',
  );
}

export function parseAiPricingTier(
  value: string | null | undefined,
): string | null | undefined {
  return parseShortLabel(
    value,
    'pricingTier',
    AI_PRICING_TIER_MAX,
    'AI_PRICING_TIER_INVALID',
  );
}

export function parseAiCostNotes(
  value: string | null | undefined,
): string | null | undefined {
  return parseShortLabel(
    value,
    'aiCostNotes',
    AI_COST_NOTES_MAX,
    'AI_COST_NOTES_INVALID',
  );
}
