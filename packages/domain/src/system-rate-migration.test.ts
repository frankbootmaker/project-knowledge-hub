import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { allocationTokenSlices } from './ai-billing.js';
import {
  DEFAULT_AI_MODEL_PRICES,
  matchAiModelPrice,
  resolveTaskCatalogRate,
  taskSupersededByImport,
  UNPRICED_MODEL_LABEL,
} from './ai-model-price.js';
import {
  planSystemRateCatalogMigration,
  retiredSystemTokenRateField,
  systemRateMigrationAudit,
  systemTokenRatesRetiredMessage,
} from './system-rate-migration.js';

const sqlPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../database/src/migrations/0080_migrate_system_token_rates.sql',
);

describe('task catalog resolution', () => {
  it('uses the workspace row, then the global row, and lists a miss', () => {
    const prices = [
      ...DEFAULT_AI_MODEL_PRICES,
      {
        workspaceId: 'ws-1',
        model: 'claude-sonnet-4',
        inputPerMillion: 1250,
        outputPerMillion: 1250,
        cacheReadPerMillion: 1250,
        cacheWritePerMillion: 1250,
        blendedPerMillion: 1250,
        currency: 'EUR',
        effectiveFrom: '1970-01-01',
        retiredAt: null,
      },
    ];
    const exact = resolveTaskCatalogRate('claude-sonnet-4', '2026-06-01', prices);
    expect(exact?.currency).toBe('EUR');
    expect(exact?.inputPer1k).toBe(1.25);
    const global = matchAiModelPrice('claude-sonnet-4', '2026-06-01', DEFAULT_AI_MODEL_PRICES);
    expect(global?.inputPerMillion).toBe(3);
    expect(resolveTaskCatalogRate('mystery-model', '2026-06-01', prices)).toBeNull();
    expect(resolveTaskCatalogRate('  ', '2026-06-01', prices)).toBeNull();
  });

  it('keeps the import supersede rule', () => {
    expect(taskSupersededByImport('agent-1', new Set(['agent-1']))).toBe(true);
    expect(taskSupersededByImport(null, new Set(['agent-1']))).toBe(false);
  });
});

describe('system rate migration', () => {
  const system = {
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
    tasks: [
      { model: 'claude-sonnet-4', tokens: 1500, status: 'done' },
      { model: 'claude-sonnet-4', tokens: 100, status: 'cancelled' },
    ],
  };

  it('copies filled rates onto an exact workspace pattern', () => {
    const plan = planSystemRateCatalogMigration({ systems: [system] });
    expect(plan.rows).toHaveLength(1);
    const row = plan.rows[0]!;
    expect(row.model).toBe('claude-sonnet-4');
    expect(row.price.currency).toBe('EUR');
    expect(row.price.effectiveFrom).toBe('1970-01-01');
    expect(row.price.inputPerMillion).toBe(2000);
    expect(row.price.outputPerMillion).toBe(1250);
    expect(row.price.cacheReadPerMillion).toBe(1250);
    expect(row.price.cacheWritePerMillion).toBe(500);
    expect(row.price.blendedPerMillion).toBe(1250);
    expect(row.price.workspaceId).toBe('ws-1');
    const resolved = resolveTaskCatalogRate(
      'claude-sonnet-4',
      '2026-04-01',
      [...DEFAULT_AI_MODEL_PRICES, row.price],
    );
    expect(resolved).toMatchObject({
      blendedPer1k: 1.25,
      inputPer1k: 2,
      outputPer1k: 1.25,
      cachePer1k: 1.25,
      cacheWritePer1k: 0.5,
      currency: 'EUR',
    });
    expect(systemRateMigrationAudit(row).action).toBeUndefined();
    expect(systemRateMigrationAudit(row)).toMatchObject({
      via: 'migration',
      migration: '0080_migrate_system_token_rates',
      unit: 'per_1m_tokens',
      currency: 'EUR',
    });
  });

  it('does not replace an existing workspace pattern', () => {
    const plan = planSystemRateCatalogMigration({
      systems: [system],
      existingWorkspacePatterns: [{ workspaceId: 'ws-1', model: 'Claude-Sonnet-4' }],
    });
    expect(plan.rows).toHaveLength(0);
    expect(plan.skippedExisting).toEqual([
      { workspaceId: 'ws-1', model: 'claude-sonnet-4', systemId: 'sys-1' },
    ]);
  });

  it('stores a star row when a system has rates and no model id', () => {
    const plan = planSystemRateCatalogMigration({
      systems: [{ ...system, tasks: [{ model: null, tokens: 10 }] }],
    });
    expect(plan.rows.map((row) => row.model)).toEqual(['*']);
  });

  it('rejects retired per-system rate fields with a clear message', () => {
    expect(retiredSystemTokenRateField({ aiCostMode: 'api' })).toBeNull();
    expect(retiredSystemTokenRateField({ aiTokenRatePer1k: 1 })).toBe('aiTokenRatePer1k');
    expect(systemTokenRatesRetiredMessage('aiTokenRatePer1k')).toContain(
      'per 1,000,000 tokens',
    );
    expect(systemTokenRatesRetiredMessage('aiTokenRatePer1k')).toContain('upsert_ai_model_price');
  });

  it('migration SQL writes the audit row and converts per 1k to per 1M', () => {
    const sql = readFileSync(sqlPath, 'utf8');
    expect(sql).toContain('ai_model_price.migrated_from_system_rate');
    expect(sql).toContain("* 1000");
    expect(sql).toContain("DATE '1970-01-01'");
    expect(sql).toContain('per_1m_tokens');
    expect(sql).toContain('0080_migrate_system_token_rates');
    expect(UNPRICED_MODEL_LABEL).toBe('(no model)');
  });
});

describe('allocation tokens are independent of the rate source', () => {
  it('keeps the same project shares before and after the catalog copy', () => {
    const tasks = [
      {
        projectId: 'proj-1',
        aiSystemId: 'sys-1',
        cloudAgentId: null,
        period: '2026-04',
        tokens: 1500,
      },
      {
        projectId: 'proj-2',
        aiSystemId: 'sys-1',
        cloudAgentId: 'covered',
        period: '2026-04',
        tokens: 9000,
      },
    ];
    const events = [
      {
        projectId: 'proj-2',
        aiSystemId: 'sys-1',
        cloudAgentId: 'covered',
        occurredAt: new Date('2026-04-15T12:00:00Z'),
        tokens: 400,
      },
    ];
    const before = allocationTokenSlices({ tasks, events });
    const after = allocationTokenSlices({ tasks, events });
    expect(after).toEqual(before);
    expect(before.find((row) => row.projectId === 'proj-2')?.tokens).toBe(400);
    expect(before.find((row) => row.projectId === 'proj-1')?.tokens).toBe(1500);
  });
});
