import { roundAiMoney } from './ai-billing.js';

/**
 * List price for one model (or a glob such as `*claude*sonnet*`).
 * Amounts are per 1,000,000 tokens (`per_1m_tokens`). `workspaceId` null is
 * the platform list. A workspace row for the same pattern replaces that
 * global row. Among different patterns, more literal characters win.
 * The latest effectiveFrom on or before the usage day wins a remaining tie.
 * Retired rows are skipped.
 */
export type AiModelPrice = {
  id?: string;
  workspaceId: string | null;
  model: string;
  inputPerMillion: number;
  cacheWritePerMillion: number;
  cacheReadPerMillion: number;
  outputPerMillion: number;
  /** Undifferentiated per-1M rate. Split rates fall back to this when null. */
  blendedPerMillion: number;
  currency: string;
  /** YYYY-MM-DD. Rows after the usage day are ignored. */
  effectiveFrom: string;
  /** Where the figure came from (provider price page or a short note). */
  sourceNote?: string | null;
  /** ISO timestamp. Set when the row is retired and must not price usage. */
  retiredAt?: string | null;
};

export type AiModelPriceScope = 'global' | 'workspace';

/** Explicit unit for import, export, and MCP. Never per 1,000 tokens. */
export const AI_MODEL_PRICE_UNIT = 'per_1m_tokens';

/**
 * Where an agent reads current list prices, and how to write them back.
 * Tool descriptions include this so the unit, source, and date are not guessed.
 */
export const AI_MODEL_PRICE_SOURCE_GUIDE = [
  'Amounts are per 1,000,000 tokens (unit per_1m_tokens), not per 1,000.',
  'Before upsert_ai_model_price, read the current provider list price:',
  'https://docs.anthropic.com/en/docs/about-claude/pricing',
  'https://developers.openai.com/api/docs/pricing',
  'https://ai.google.dev/gemini-api/docs/pricing',
  'https://docs.x.ai/docs/models',
  'https://cursor.com/docs/models',
  'Always send sourceNote (the page or note you used) and effectiveFrom (YYYY-MM-DD).',
  'scope global edits the platform list and needs a platform administrator.',
  'scope workspace overrides one pattern or adds a pattern and needs a workspace administrator.',
  'Resolution is workspace override, then global, otherwise unpriced.',
  'Task-recorded tokens use that same resolution for the task model.',
  'A task or import with no matching row is listed as unpriced, not priced at zero.',
  'A pattern with more literal characters wins. cursor-grok-4.5-high matches *grok*.',
  'Retire with retire_ai_model_price. List with list_ai_model_prices.',
].join(' ');

export function aiModelPriceToolDescription(
  action: 'list' | 'upsert' | 'retire',
): string {
  const lead = {
    list:
      'List global and workspace AI model prices. Each row has scope (global or workspace), inherited (the workspace is using that global row), and overridden (a workspace row replaced that global pattern).',
    upsert:
      'Create or replace one AI model price (pattern, input, output, cache read, cache write, blended, currency, effectiveFrom, sourceNote). Same pattern and effectiveFrom updates the row and clears retired.',
    retire:
      'Retire one AI model price so it no longer prices usage. Pass priceId, or model plus effectiveFrom.',
  }[action];
  return `${lead} ${AI_MODEL_PRICE_SOURCE_GUIDE}`;
}

export type UsageTokenCounts = {
  tokensInput: number;
  tokensCacheWrite: number;
  tokensCache: number;
  tokensOutput: number;
};

/**
 * Seeded platform defaults (USD per 1M tokens, from 2026-01-01).
 * A leading star also matches Cursor ids such as `cursor-grok-4.5-high`.
 * Blended starts equal to the input rate until an admin sets a provider blend.
 * Unknown models stay unpriced.
 */
const SEEDED_SOURCE_NOTE =
  'Seeded platform default, effective 2026-01-01. Confirm at the provider price page before editing.';

export const DEFAULT_AI_MODEL_PRICES: readonly AiModelPrice[] = [
  price('*composer*', 1.25, 1.25, 0.125, 10),
  price('*claude*haiku*', 1, 1.25, 0.1, 5),
  price('*claude*opus*', 15, 18.75, 1.5, 75),
  price('*claude*sonnet*', 3, 3.75, 0.3, 15),
  price('*claude*', 3, 3.75, 0.3, 15),
  price('*gpt*mini*', 0.4, 0, 0.1, 1.6),
  price('*gpt-4o*', 2.5, 0, 1.25, 10),
  price('*gpt*', 2.5, 0, 1.25, 10),
  price('*grok*', 3, 3.75, 0.75, 15),
  price('*gemini*flash*', 0.3, 0, 0.03, 2.5),
  price('*gemini*', 1.25, 0, 0.125, 10),
];

function price(
  model: string,
  inputPerMillion: number,
  cacheWritePerMillion: number,
  cacheReadPerMillion: number,
  outputPerMillion: number,
  blendedPerMillion = inputPerMillion,
): AiModelPrice {
  return {
    workspaceId: null,
    model,
    inputPerMillion,
    cacheWritePerMillion,
    cacheReadPerMillion,
    outputPerMillion,
    blendedPerMillion,
    currency: 'USD',
    effectiveFrom: '2026-01-01',
    sourceNote: SEEDED_SOURCE_NOTE,
    retiredAt: null,
  };
}

export function patternKey(pattern: string): string {
  return pattern.trim().toLowerCase();
}

function patternLiterals(pattern: string): number {
  return pattern.replace(/\*/g, '').length;
}

/** Glob: `*` is any run of characters. A pattern with no star is exact. */
export function globMatches(pattern: string, model: string): boolean {
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
 * Glob match, plus a single leading `cursor-` on the model id.
 * `grok*` and `*grok*` both price `cursor-grok-4.5-high`.
 * A pattern that already names `cursor-` is not stripped a second time.
 */
export function modelPatternMatches(pattern: string, model: string): boolean {
  if (globMatches(pattern, model)) return true;
  const needle = pattern.trim().toLowerCase();
  const haystack = model.trim().toLowerCase();
  if (!haystack.startsWith('cursor-')) return false;
  if (needle.startsWith('cursor-') || needle.includes('cursor-')) return false;
  return globMatches(pattern, haystack.slice('cursor-'.length));
}

/**
 * Price in force for a model on a usage day.
 * Null when nothing matches: the row is flagged, not priced at zero silently.
 * A workspace row hides the global row with the same pattern. Other patterns
 * still compete by specificity, then workspace over global, then later
 * effectiveFrom, then pattern text.
 */
export function matchAiModelPrice(
  model: string,
  onDate: string,
  prices: readonly AiModelPrice[],
): AiModelPrice | null {
  const active = prices.filter(
    (row) =>
      !row.retiredAt &&
      row.effectiveFrom <= onDate &&
      modelPatternMatches(row.model, model),
  );
  if (active.length === 0) return null;
  const workspacePatterns = new Set(
    active.filter((row) => row.workspaceId != null).map((row) => patternKey(row.model)),
  );
  const candidates = active.filter(
    (row) =>
      row.workspaceId != null || !workspacePatterns.has(patternKey(row.model)),
  );
  candidates.sort((left, right) => {
    const specificity = patternLiterals(right.model) - patternLiterals(left.model);
    if (specificity !== 0) return specificity;
    const scope = Number(right.workspaceId != null) - Number(left.workspaceId != null);
    if (scope !== 0) return scope;
    const effective = right.effectiveFrom.localeCompare(left.effectiveFrom);
    if (effective !== 0) return effective;
    return patternKey(right.model).localeCompare(patternKey(left.model));
  });
  return candidates[0] ?? null;
}

export type AiModelPriceView = AiModelPrice & {
  scope: AiModelPriceScope;
  /** Global row the workspace still uses. */
  inherited: boolean;
  /** Global row hidden by a workspace row with the same pattern. */
  overridden: boolean;
  /** Workspace row that replaces a global pattern. */
  overridesGlobal: boolean;
  retired: boolean;
  unit: typeof AI_MODEL_PRICE_UNIT;
};

/** scope / inherited / overridden flags for list_ai_model_prices and the UI. */
export function presentAiModelPrices(
  prices: readonly AiModelPrice[],
): AiModelPriceView[] {
  const workspacePatterns = new Set(
    prices
      .filter((row) => row.workspaceId != null && !row.retiredAt)
      .map((row) => patternKey(row.model)),
  );
  const globalPatterns = new Set(
    prices
      .filter((row) => row.workspaceId == null && !row.retiredAt)
      .map((row) => patternKey(row.model)),
  );
  return prices.map((row) => {
    const retired = Boolean(row.retiredAt);
    const scope: AiModelPriceScope = row.workspaceId ? 'workspace' : 'global';
    const key = patternKey(row.model);
    const overridden = scope === 'global' && !retired && workspacePatterns.has(key);
    const inherited = scope === 'global' && !retired && !overridden;
    const overridesGlobal =
      scope === 'workspace' && !retired && globalPatterns.has(key);
    return {
      ...row,
      scope,
      inherited,
      overridden,
      overridesGlobal,
      retired,
      unit: AI_MODEL_PRICE_UNIT,
    };
  });
}

/**
 * Blank split rate uses the blended rate. An explicit 0 stays 0.
 * `inherited` is true when the shown number comes from blended.
 */
export function fallbackTokenRate(
  specific: number | null | undefined,
  blended: number | null | undefined,
): { amount: number | null; inherited: boolean } {
  if (specific != null && Number.isFinite(specific)) {
    return { amount: specific, inherited: false };
  }
  if (blended != null && Number.isFinite(blended)) {
    return { amount: blended, inherited: true };
  }
  return { amount: null, inherited: false };
}

export type ModelPriceActor = {
  active: boolean;
  isSystemAdmin: boolean;
  workspaceRole: string | null;
};

/**
 * Platform admin for global. Workspace admin (or platform admin) for workspace.
 * Maintainers and members cannot write prices.
 */
export function modelPriceScopeDenial(
  scope: AiModelPriceScope,
  actor: ModelPriceActor,
): string | null {
  if (!actor.active) return 'Acting user cannot change model prices';
  if (scope === 'global') {
    if (!actor.isSystemAdmin) return 'Platform administrator privileges are required';
    return null;
  }
  if (actor.isSystemAdmin) return null;
  if (actor.workspaceRole !== 'workspace_admin') {
    return 'Workspace administrator privileges are required';
  }
  return null;
}

const SECRET_NOTE = /Bearer\s+\S+|sk-[A-Za-z0-9]{8,}|(?:api[_-]?key|token|secret)\s*[:=]\s*\S+/gi;

/** Audit copy of a source note. Drops credential-shaped text. */
export function redactPriceNote(note: string | null | undefined): string | null {
  if (note == null) return null;
  const trimmed = note.trim();
  if (!trimmed) return null;
  return trimmed.replace(SECRET_NOTE, '[redacted]').slice(0, 200);
}

export function auditModelPriceMetadata(input: {
  scope: AiModelPriceScope;
  workspaceId?: string | null;
  model?: string | null;
  effectiveFrom?: string | null;
  currency?: string | null;
  sourceNote?: string | null;
  via: 'mcp' | 'http';
  counts?: { added: number; changed: number; unchanged: number };
}): Record<string, unknown> {
  return {
    scope: input.scope,
    workspaceId: input.workspaceId ?? null,
    model: input.model ?? null,
    effectiveFrom: input.effectiveFrom ?? null,
    currency: input.currency ?? null,
    sourceNote: redactPriceNote(input.sourceNote),
    unit: AI_MODEL_PRICE_UNIT,
    via: input.via,
    ...(input.counts ? { counts: input.counts } : {}),
  };
}

export type AiModelPriceWrite = {
  model: string;
  inputPerMillion: number;
  cacheWritePerMillion: number;
  cacheReadPerMillion: number;
  outputPerMillion: number;
  blendedPerMillion: number;
  currency: string;
  effectiveFrom: string;
  sourceNote: string | null;
};

export type PriceFieldError = { field: string; message: string };

const RATE_FIELDS = [
  'inputPerMillion',
  'outputPerMillion',
  'cacheReadPerMillion',
  'cacheWritePerMillion',
  'blendedPerMillion',
] as const;

function roundRate(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/** Schema check for one price row. sourceNote may be omitted on older HTTP saves. */
export function validateAiModelPriceWrite(
  input: Partial<AiModelPriceWrite> & { model?: string },
  options?: { requireSourceNote?: boolean },
): { ok: true; price: AiModelPriceWrite } | { ok: false; errors: PriceFieldError[] } {
  const errors: PriceFieldError[] = [];
  const model = (input.model ?? '').trim();
  if (model.length < 1 || model.length > 80) {
    errors.push({ field: 'model', message: 'pattern must be 1–80 characters' });
  }
  if (model.includes(',') || /[\r\n]/.test(model)) {
    errors.push({ field: 'model', message: 'pattern cannot contain commas or line breaks' });
  }
  const currency = (input.currency ?? '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    errors.push({ field: 'currency', message: 'currency must be a 3-letter ISO code' });
  }
  const effectiveFrom = (input.effectiveFrom ?? '').trim();
  if (!isIsoDate(effectiveFrom)) {
    errors.push({ field: 'effectiveFrom', message: 'effectiveFrom must be a real YYYY-MM-DD date' });
  }
  const rates: Record<(typeof RATE_FIELDS)[number], number> = {
    inputPerMillion: Number.NaN,
    outputPerMillion: Number.NaN,
    cacheReadPerMillion: Number.NaN,
    cacheWritePerMillion: Number.NaN,
    blendedPerMillion: Number.NaN,
  };
  for (const field of RATE_FIELDS) {
    const value = input[field];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1_000_000) {
      errors.push({
        field,
        message: `${field} must be zero or a positive amount per 1,000,000 tokens`,
      });
    } else {
      rates[field] = roundRate(value);
    }
  }
  let sourceNote: string | null = null;
  if (input.sourceNote == null || input.sourceNote.trim() === '') {
    if (options?.requireSourceNote) {
      errors.push({
        field: 'sourceNote',
        message: 'sourceNote is required (the provider price page or a short note)',
      });
    }
  } else {
    sourceNote = input.sourceNote.trim();
    if (sourceNote.length > 500) {
      errors.push({ field: 'sourceNote', message: 'sourceNote must be at most 500 characters' });
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    price: {
      model,
      currency,
      effectiveFrom,
      sourceNote,
      inputPerMillion: rates.inputPerMillion,
      outputPerMillion: rates.outputPerMillion,
      cacheReadPerMillion: rates.cacheReadPerMillion,
      cacheWritePerMillion: rates.cacheWritePerMillion,
      blendedPerMillion: rates.blendedPerMillion,
    },
  };
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

/** Shown when a task recorded tokens and no model id. */
export const UNPRICED_MODEL_LABEL = '(no model)';

export type CatalogPer1kRates = {
  blendedPer1k: number;
  inputPer1k: number;
  outputPer1k: number;
  cachePer1k: number;
  cacheWritePer1k: number;
  currency: string;
};

function perMillionToPer1k(amount: number): number {
  return amount / 1000;
}

/** Catalog row as the per-1k rates the legacy token math already rounds with. */
export function catalogPriceToPer1k(price: AiModelPrice): CatalogPer1kRates {
  return {
    blendedPer1k: perMillionToPer1k(price.blendedPerMillion),
    inputPer1k: perMillionToPer1k(price.inputPerMillion),
    outputPer1k: perMillionToPer1k(price.outputPerMillion),
    cachePer1k: perMillionToPer1k(price.cacheReadPerMillion),
    cacheWritePer1k: perMillionToPer1k(price.cacheWritePerMillion),
    currency: price.currency,
  };
}

/**
 * Catalog rate for one task. Null is unpriced (listed), not a silent zero rate.
 * Blank model does not match a pattern. Same glob order as imported usage:
 * workspace override, then global.
 */
export function resolveTaskCatalogRate(
  model: string | null | undefined,
  onDate: string,
  prices: readonly AiModelPrice[],
): CatalogPer1kRates | null {
  const name = model?.trim() ?? '';
  if (!name) return null;
  const price = matchAiModelPrice(name, onDate, prices);
  if (!price) return null;
  return catalogPriceToPer1k(price);
}

export function unpricedModelKey(model: string | null | undefined): string {
  const name = model?.trim() ?? '';
  return name || UNPRICED_MODEL_LABEL;
}

export function mergeUnpricedModels(
  lists: readonly (readonly UnpricedModel[])[],
): UnpricedModel[] {
  const merged = new Map<string, UnpricedModel>();
  for (const list of lists) {
    for (const row of list) {
      const current = merged.get(row.model) ?? {
        model: row.model,
        rowCount: 0,
        tokensTotal: 0,
      };
      current.rowCount += row.rowCount;
      current.tokensTotal += row.tokensTotal;
      merged.set(row.model, current);
    }
  }
  return [...merged.values()].sort((left, right) => left.model.localeCompare(right.model));
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
