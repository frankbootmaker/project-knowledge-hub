import type { AiModelPrice } from './ai-model-price.js';
import { AI_MODEL_PRICE_UNIT } from './ai-model-price.js';

/**
 * One-off copy of filled per-system per-1k rates into workspace catalog rows.
 * Amounts are multiplied by 1,000 so they are per 1,000,000 tokens.
 * A null split rate is stored as the blended rate (the old fallback).
 * An explicit 0 stays 0. Currency is the system currency, else the linked
 * project's currency, else USD.
 */
export const MIGRATED_SYSTEM_RATE_EFFECTIVE_FROM = '1970-01-01';

export const RETIRED_SYSTEM_TOKEN_RATE_FIELDS = [
  'aiTokenRatePer1k',
  'aiTokenRateInputPer1k',
  'aiTokenRateOutputPer1k',
  'aiTokenRateCachePer1k',
  'aiTokenRateCacheWritePer1k',
  'aiTokenRateCurrency',
] as const;

export type RetiredSystemTokenRateField = (typeof RETIRED_SYSTEM_TOKEN_RATE_FIELDS)[number];

export function retiredSystemTokenRateField(
  input: object,
): RetiredSystemTokenRateField | null {
  for (const field of RETIRED_SYSTEM_TOKEN_RATE_FIELDS) {
    if (
      Object.prototype.hasOwnProperty.call(input, field) &&
      (input as Record<string, unknown>)[field] !== undefined
    ) {
      return field;
    }
  }
  return null;
}

export function systemTokenRatesRetiredMessage(field: string): string {
  return (
    `Per-system token rates were removed (${field}). ` +
    'Task tokens use the model price list, per 1,000,000 tokens. ' +
    'Write a price with upsert_ai_model_price.'
  );
}

export type SystemTokenRatesPer1k = {
  blendedPer1k: number | null;
  inputPer1k: number | null;
  outputPer1k: number | null;
  cachePer1k: number | null;
  cacheWritePer1k: number | null;
  currency: string | null;
};

export type SystemRateMigrationTask = {
  model: string | null;
  /** Non-cancelled, non-archived tasks only. */
  tokens: number;
  status?: string | null;
  archived?: boolean;
};

export type SystemRateMigrationSystem = {
  systemId: string;
  workspaceId: string;
  systemName: string;
  projectCurrency: string | null;
  rates: SystemTokenRatesPer1k;
  tasks: readonly SystemRateMigrationTask[];
};

export type SystemRateCatalogRow = {
  workspaceId: string;
  systemId: string;
  model: string;
  price: AiModelPrice;
  /** Other systems in the workspace wanted a different rate for this pattern. */
  conflictSystemIds: string[];
};

export type SystemRateMigrationPlan = {
  rows: SystemRateCatalogRow[];
  /** Filled rates that were not copied because a workspace row already covers the pattern. */
  skippedExisting: Array<{ workspaceId: string; model: string; systemId: string }>;
};

type NormalizedRates = {
  blendedPer1k: number | null;
  inputPer1k: number;
  outputPer1k: number;
  cachePer1k: number;
  cacheWritePer1k: number;
  blendedStored: number;
  currency: string;
};

function roundPerMillion(amount: number): number {
  return Math.round(amount * 1_000_000) / 1_000_000;
}

function per1kToPerMillion(amount: number): number {
  return roundPerMillion(amount * 1000);
}

export function systemHasTokenRates(rates: SystemTokenRatesPer1k): boolean {
  return [
    rates.blendedPer1k,
    rates.inputPer1k,
    rates.outputPer1k,
    rates.cachePer1k,
    rates.cacheWritePer1k,
  ].some((value) => value != null && Number.isFinite(value));
}

function currencyOf(rates: SystemTokenRatesPer1k, projectCurrency: string | null): string {
  const stored = (rates.currency ?? '').trim().toUpperCase();
  if (/^[A-Z]{3}$/.test(stored)) return stored;
  const project = (projectCurrency ?? '').trim().toUpperCase();
  if (/^[A-Z]{3}$/.test(project)) return project;
  return 'USD';
}

export function normalizeSystemRates(
  rates: SystemTokenRatesPer1k,
  projectCurrency: string | null,
): NormalizedRates {
  const blended = finiteOrNull(rates.blendedPer1k);
  const pick = (specific: number | null) => {
    const value = finiteOrNull(specific);
    if (value != null) return value;
    return blended ?? 0;
  };
  return {
    blendedPer1k: blended,
    inputPer1k: pick(rates.inputPer1k),
    outputPer1k: pick(rates.outputPer1k),
    cachePer1k: pick(rates.cachePer1k),
    cacheWritePer1k: pick(rates.cacheWritePer1k),
    blendedStored: blended ?? 0,
    currency: currencyOf(rates, projectCurrency),
  };
}

function finiteOrNull(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return value;
}

function rateKey(rates: NormalizedRates): string {
  return [
    rates.currency,
    rates.blendedStored,
    rates.inputPer1k,
    rates.outputPer1k,
    rates.cachePer1k,
    rates.cacheWritePer1k,
  ].join('|');
}

function toPrice(
  workspaceId: string,
  model: string,
  rates: NormalizedRates,
  systemName: string,
): AiModelPrice {
  const note =
    `Migrated from system token rates (per 1,000 tokens) for ${systemName}.`;
  return {
    workspaceId,
    model,
    inputPerMillion: per1kToPerMillion(rates.inputPer1k),
    outputPerMillion: per1kToPerMillion(rates.outputPer1k),
    cacheReadPerMillion: per1kToPerMillion(rates.cachePer1k),
    cacheWritePerMillion: per1kToPerMillion(rates.cacheWritePer1k),
    blendedPerMillion: per1kToPerMillion(rates.blendedStored),
    currency: rates.currency,
    effectiveFrom: MIGRATED_SYSTEM_RATE_EFFECTIVE_FROM,
    sourceNote: note.slice(0, 500),
    retiredAt: null,
  };
}

function patternKey(model: string): string {
  return model.trim().toLowerCase();
}

type Candidate = {
  workspaceId: string;
  systemId: string;
  systemName: string;
  model: string;
  tokens: number;
  rates: NormalizedRates;
};

function qualifyingTasks(system: SystemRateMigrationSystem): SystemRateMigrationTask[] {
  return system.tasks.filter((task) => {
    if (task.archived) return false;
    if (task.status === 'cancelled') return false;
    const model = task.model?.trim() ?? '';
    return model.length > 0 && model.length <= 80 && !/[\r\n]/.test(model);
  });
}

/**
 * Workspace catalog rows that reproduce filled system rates.
 * Each task model becomes an exact pattern so it wins over a broader global glob.
 * Systems with rates but no model id share one `*` row when their rates agree.
 * An existing active workspace pattern is left alone.
 * When two systems disagree on one pattern, the greater token total wins.
 */
export function planSystemRateCatalogMigration(input: {
  systems: readonly SystemRateMigrationSystem[];
  existingWorkspacePatterns?: readonly { workspaceId: string; model: string }[];
}): SystemRateMigrationPlan {
  const existing = new Set(
    (input.existingWorkspacePatterns ?? []).map(
      (row) => `${row.workspaceId}|${patternKey(row.model)}`,
    ),
  );
  const candidates: Candidate[] = [];
  const modeless: Candidate[] = [];

  for (const system of input.systems) {
    if (!systemHasTokenRates(system.rates)) continue;
    const rates = normalizeSystemRates(system.rates, system.projectCurrency);
    const tasks = qualifyingTasks(system);
    if (tasks.length === 0) {
      modeless.push({
        workspaceId: system.workspaceId,
        systemId: system.systemId,
        systemName: system.systemName,
        model: '*',
        tokens: 0,
        rates,
      });
      continue;
    }
    const byModel = new Map<string, Candidate>();
    for (const task of tasks) {
      const model = task.model!.trim();
      const key = patternKey(model);
      const current = byModel.get(key);
      if (!current) {
        byModel.set(key, {
          workspaceId: system.workspaceId,
          systemId: system.systemId,
          systemName: system.systemName,
          model,
          tokens: Math.max(0, task.tokens),
          rates,
        });
      } else {
        current.tokens += Math.max(0, task.tokens);
        if (model.length > current.model.length) current.model = model;
      }
    }
    candidates.push(...byModel.values());
  }

  const rows: SystemRateCatalogRow[] = [];
  const skippedExisting: SystemRateMigrationPlan['skippedExisting'] = [];
  const grouped = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    const key = `${candidate.workspaceId}|${patternKey(candidate.model)}`;
    const list = grouped.get(key) ?? [];
    list.push(candidate);
    grouped.set(key, list);
  }

  for (const [key, list] of grouped) {
    const winner = pickWinner(list);
    const model = winner.model;
    if (existing.has(key)) {
      skippedExisting.push({
        workspaceId: winner.workspaceId,
        model,
        systemId: winner.systemId,
      });
      continue;
    }
    const conflictSystemIds = [
      ...new Set(
        list
          .filter((row) => row.systemId !== winner.systemId && rateKey(row.rates) !== rateKey(winner.rates))
          .map((row) => row.systemId),
      ),
    ].sort();
    rows.push({
      workspaceId: winner.workspaceId,
      systemId: winner.systemId,
      model,
      price: toPrice(winner.workspaceId, model, winner.rates, winner.systemName),
      conflictSystemIds,
    });
  }

  const modelessByWorkspace = new Map<string, Candidate[]>();
  for (const candidate of modeless) {
    const list = modelessByWorkspace.get(candidate.workspaceId) ?? [];
    list.push(candidate);
    modelessByWorkspace.set(candidate.workspaceId, list);
  }
  for (const [workspaceId, list] of modelessByWorkspace) {
    const keys = new Set(list.map((row) => rateKey(row.rates)));
    const winner = [...list].sort((left, right) => left.systemId.localeCompare(right.systemId))[0];
    if (!winner || keys.size !== 1) continue;
    const key = `${workspaceId}|*`;
    if (existing.has(key) || grouped.has(key)) {
      skippedExisting.push({
        workspaceId,
        model: '*',
        systemId: winner.systemId,
      });
      continue;
    }
    rows.push({
      workspaceId,
      systemId: winner.systemId,
      model: '*',
      price: toPrice(workspaceId, '*', winner.rates, winner.systemName),
      conflictSystemIds: [],
    });
  }

  rows.sort(
    (left, right) =>
      left.workspaceId.localeCompare(right.workspaceId) ||
      left.model.localeCompare(right.model) ||
      left.systemId.localeCompare(right.systemId),
  );
  return { rows, skippedExisting };
}

function pickWinner(list: Candidate[]): Candidate {
  return [...list].sort((left, right) => {
    if (right.tokens !== left.tokens) return right.tokens - left.tokens;
    return left.systemId.localeCompare(right.systemId);
  })[0]!;
}

export function systemRateMigrationAudit(row: SystemRateCatalogRow): Record<string, unknown> {
  return {
    scope: 'workspace',
    workspaceId: row.workspaceId,
    systemId: row.systemId,
    model: row.model,
    currency: row.price.currency,
    unit: AI_MODEL_PRICE_UNIT,
    via: 'migration',
    migration: '0080_migrate_system_token_rates',
    effectiveFrom: row.price.effectiveFrom,
    conflictSystemIds: row.conflictSystemIds,
    per1m: {
      input: row.price.inputPerMillion,
      output: row.price.outputPerMillion,
      cacheRead: row.price.cacheReadPerMillion,
      cacheWrite: row.price.cacheWritePerMillion,
      blended: row.price.blendedPerMillion,
    },
  };
}
