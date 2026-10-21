import { roundAiMoney } from './ai-billing.js';

/**
 * List price for one model (or a glob such as `claude*sonnet*`).
 * Amounts are per 1,000,000 tokens. `workspaceId` null is a seeded default.
 * A workspace row wins over a default. A longer literal wins over a shorter
 * glob. The latest effectiveFrom on or before the usage day wins.
 */
export type AiModelPrice = {
  id?: string;
  workspaceId: string | null;
  model: string;
  inputPerMillion: number;
  cacheWritePerMillion: number;
  cacheReadPerMillion: number;
  outputPerMillion: number;
  currency: string;
  /** YYYY-MM-DD. Rows after the usage day are ignored. */
  effectiveFrom: string;
};

export type UsageTokenCounts = {
  tokensInput: number;
  tokensCacheWrite: number;
  tokensCache: number;
  tokensOutput: number;
};

/**
 * Seeded Cursor-family defaults (USD per 1M tokens, from 2026-01-01).
 * Globs cover composer, claude-*, gpt-*, grok-*, and gemini-*.
 * Workspace admins replace these; unknown models stay unpriced.
 */
export const DEFAULT_AI_MODEL_PRICES: readonly AiModelPrice[] = [
  price('composer*', 1.25, 1.25, 0.125, 10),
  price('claude*haiku*', 1, 1.25, 0.1, 5),
  price('claude*opus*', 15, 18.75, 1.5, 75),
  price('claude*sonnet*', 3, 3.75, 0.3, 15),
  price('claude*', 3, 3.75, 0.3, 15),
  price('gpt*mini*', 0.4, 0, 0.1, 1.6),
  price('gpt-4o*', 2.5, 0, 1.25, 10),
  price('gpt*', 2.5, 0, 1.25, 10),
  price('grok*', 3, 3.75, 0.75, 15),
  price('gemini*flash*', 0.3, 0, 0.03, 2.5),
  price('gemini*', 1.25, 0, 0.125, 10),
];

function price(
  model: string,
  inputPerMillion: number,
  cacheWritePerMillion: number,
  cacheReadPerMillion: number,
  outputPerMillion: number,
): AiModelPrice {
  return {
    workspaceId: null,
    model,
    inputPerMillion,
    cacheWritePerMillion,
    cacheReadPerMillion,
    outputPerMillion,
    currency: 'USD',
    effectiveFrom: '2026-01-01',
  };
}

function patternLiterals(pattern: string): number {
  return pattern.replace(/\*/g, '').length;
}

/** Glob: `*` is any run of characters. A pattern with no star is exact. */
export function modelPatternMatches(pattern: string, model: string): boolean {
  const needle = pattern.trim().toLowerCase();
  const haystack = model.trim().toLowerCase();
  if (!needle || !haystack) return false;
  if (!needle.includes('*')) return needle === haystack;
  const parts = needle.split('*').filter((part) => part.length > 0);
  if (parts.length === 0) return true;
  let index = 0;
  for (const part of parts) {
    const found = haystack.indexOf(part, index);
    if (found < 0) return false;
    index = found + part.length;
  }
  const first = parts[0] ?? '';
  const last = parts[parts.length - 1] ?? '';
  if (!needle.startsWith('*') && !haystack.startsWith(first)) return false;
  if (!needle.endsWith('*') && !haystack.endsWith(last)) return false;
  return true;
}

/**
 * Price in force for a model on a usage day.
 * Null when nothing matches: the row is flagged, not priced at zero silently.
 */
export function matchAiModelPrice(
  model: string,
  onDate: string,
  prices: readonly AiModelPrice[],
): AiModelPrice | null {
  const matches = prices.filter(
    (row) => row.effectiveFrom <= onDate && modelPatternMatches(row.model, model),
  );
  if (matches.length === 0) return null;
  matches.sort((left, right) => {
    const scope = Number(right.workspaceId != null) - Number(left.workspaceId != null);
    if (scope !== 0) return scope;
    const specificity = patternLiterals(right.model) - patternLiterals(left.model);
    if (specificity !== 0) return specificity;
    return right.effectiveFrom.localeCompare(left.effectiveFrom);
  });
  return matches[0] ?? null;
}

/** Theoretical API cost in the price currency, rounded to cents. */
export function theoreticalTokenCost(
  tokens: UsageTokenCounts,
  rate: Pick<
    AiModelPrice,
    | 'inputPerMillion'
    | 'cacheWritePerMillion'
    | 'cacheReadPerMillion'
    | 'outputPerMillion'
  >,
): number {
  const raw =
    (tokens.tokensInput / 1_000_000) * rate.inputPerMillion +
    (tokens.tokensCacheWrite / 1_000_000) * rate.cacheWritePerMillion +
    (tokens.tokensCache / 1_000_000) * rate.cacheReadPerMillion +
    (tokens.tokensOutput / 1_000_000) * rate.outputPerMillion;
  if (!Number.isFinite(raw)) return 0;
  return roundAiMoney(raw);
}

/**
 * CSV Cost column. "Included", blank, and other words are unpaid (null).
 * A numeric amount is the paid figure shown beside the theoretical cost.
 */
export function parseUsagePaidAmount(cost: string | null | undefined): number | null {
  if (cost == null) return null;
  const trimmed = cost.trim();
  if (!trimmed || /^included$/i.test(trimmed) || trimmed === '-' || trimmed === '—') {
    return null;
  }
  const numeric = trimmed.replace(/[$,\s]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(numeric)) return null;
  const value = Number(numeric);
  if (!Number.isFinite(value)) return null;
  return roundAiMoney(value);
}

export type ImportedUsageForPrice = UsageTokenCounts & {
  occurredOn: string;
  model: string;
  cost?: string | null;
  linked: boolean;
  projectId?: string | null;
  projectName?: string | null;
  cloudAgentId?: string | null;
};

export type PricedImportedUsage = {
  occurredOn: string;
  model: string;
  currency: string;
  theoretical: number;
  paid: number | null;
  priced: boolean;
  linked: boolean;
  projectId: string | null;
  projectName: string | null;
  cloudAgentId: string | null;
};

export type UnpricedModel = {
  model: string;
  rowCount: number;
  tokensTotal: number;
};

export type TheoreticalMonthSplit = {
  period: string;
  currency: string;
  linked: number;
  unassigned: number;
  total: number;
};

/** Imported rows replace task-reported usage for the same cloud agent. */
export function importedCloudAgentIds(
  rows: readonly { cloudAgentId?: string | null }[],
): Set<string> {
  const ids = new Set<string>();
  for (const row of rows) {
    const id = row.cloudAgentId?.trim();
    if (id) ids.add(id);
  }
  return ids;
}

export function taskSupersededByImport(
  cloudAgentId: string | null | undefined,
  imported: ReadonlySet<string>,
): boolean {
  const id = cloudAgentId?.trim();
  if (!id) return false;
  return imported.has(id);
}

/**
 * Price every imported row. Unmatched models stay at 0 and are listed.
 * "Included" still gets a theoretical cost. Re-running is idempotent.
 */
export function priceImportedUsage(
  rows: readonly ImportedUsageForPrice[],
  prices: readonly AiModelPrice[],
): {
  rows: PricedImportedUsage[];
  unpricedModels: UnpricedModel[];
  months: TheoreticalMonthSplit[];
} {
  const priced: PricedImportedUsage[] = [];
  const unpriced = new Map<string, UnpricedModel>();
  for (const row of rows) {
    const rate = matchAiModelPrice(row.model, row.occurredOn, prices);
    const theoretical = rate ? theoreticalTokenCost(row, rate) : 0;
    if (!rate) {
      const key = row.model.trim() || '(blank)';
      const current = unpriced.get(key) ?? { model: key, rowCount: 0, tokensTotal: 0 };
      current.rowCount += 1;
      current.tokensTotal +=
        row.tokensInput + row.tokensCacheWrite + row.tokensCache + row.tokensOutput;
      unpriced.set(key, current);
    }
    priced.push({
      occurredOn: row.occurredOn,
      model: row.model,
      currency: rate?.currency ?? 'USD',
      theoretical,
      paid: parseUsagePaidAmount(row.cost),
      priced: rate != null,
      linked: row.linked,
      projectId: row.projectId ?? null,
      projectName: row.projectName ?? null,
      cloudAgentId: row.cloudAgentId ?? null,
    });
  }
  return {
    rows: priced,
    unpricedModels: [...unpriced.values()].sort((a, b) => a.model.localeCompare(b.model)),
    months: theoreticalMonths(priced),
  };
}

export function theoreticalMonths(
  rows: readonly Pick<PricedImportedUsage, 'occurredOn' | 'currency' | 'theoretical' | 'linked'>[],
): TheoreticalMonthSplit[] {
  const buckets = new Map<string, TheoreticalMonthSplit>();
  for (const row of rows) {
    if (!row.occurredOn || row.theoretical === 0) continue;
    const period = row.occurredOn.slice(0, 7);
    const key = `${period}|${row.currency}`;
    const current = buckets.get(key) ?? {
      period,
      currency: row.currency,
      linked: 0,
      unassigned: 0,
      total: 0,
    };
    if (row.linked) current.linked += row.theoretical;
    else current.unassigned += row.theoretical;
    current.total += row.theoretical;
    buckets.set(key, current);
  }
  return [...buckets.values()]
    .map((row) => ({
      ...row,
      linked: roundAiMoney(row.linked),
      unassigned: roundAiMoney(row.unassigned),
      total: roundAiMoney(row.total),
    }))
    .sort(
      (a, b) => a.period.localeCompare(b.period) || a.currency.localeCompare(b.currency),
    );
}
