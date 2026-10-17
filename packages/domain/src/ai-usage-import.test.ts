import { describe, expect, it } from 'vitest';
import {
  aggregateLinkedUsage,
  dedupeUsageRows,
  linkUsageRows,
  mapCursorUsageTokens,
  parseCursorUsageCsv,
  parseUsageSource,
  previewUsageImport,
  usageRowHash,
} from './ai-usage-import.js';

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

/** Trimmed from the Oct 2026 Cursor usage export. Not the full file. */
const SAMPLE = [
  HEADER,
  '"2026-10-17T14:52:56.907Z","","","Included","grok-bot-default","No","550","2","61231","580","62363","Included"',
  '"2026-10-17T14:52:01.092Z","","","Included","grok-bot-default","No","1794","4","150429","5327","157554","Included"',
  '"2026-10-17T14:27:59.240Z","bc-ef37ff6f-fc60-57c0-aded-6af2de468404","","Included","composer-2.5","No","0","77552","471741","4013","553306","Included"',
  '"2026-10-17T13:24:00.025Z","bc-ef37ff6f-fc60-57c0-aded-6af2de468404","","Included","composer-2.5","No","0","7804","811858","1991","821653","Included"',
].join('\n');

describe('Cursor usage CSV mapping', () => {
  it('treats the two input columns as disjoint buckets that sum to the total', () => {
    const parsed = parseCursorUsageCsv(SAMPLE);
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toHaveLength(4);

    const first = parsed.rows[0]!;
    expect(first.tokensInput).toBe(2);
    expect(first.tokensCacheWrite).toBe(550);
    expect(first.tokensCache).toBe(61231);
    expect(first.tokensOutput).toBe(580);
    expect(first.tokensTotal).toBe(62363);
    expect(
      first.tokensInput +
        first.tokensCacheWrite +
        first.tokensCache +
        first.tokensOutput,
    ).toBe(first.tokensTotal);
    expect(first.cloudAgentId).toBeNull();
    expect(first.maxMode).toBe(false);
    expect(first.kind).toBe('Included');
    expect(first.cost).toBe('Included');

    const mapped = mapCursorUsageTokens({
      inputWithCacheWrite: 550,
      inputWithoutCacheWrite: 2,
      cacheRead: 61231,
      outputTokens: 580,
      totalTokens: 62363,
    });
    expect(mapped.tokensCacheWrite).toBe(550);
    expect(mapped.tokensCacheWrite).not.toBe(550 - 2);
  });

  it('keeps cloud-agent rows whose cache-write column is 0', () => {
    const parsed = parseCursorUsageCsv(SAMPLE);
    const agent = parsed.rows[2]!;
    expect(agent.cloudAgentId).toBe('bc-ef37ff6f-fc60-57c0-aded-6af2de468404');
    expect(agent.tokensInput).toBe(77552);
    expect(agent.tokensCacheWrite).toBe(0);
    expect(agent.tokensCache).toBe(471741);
    expect(agent.tokensOutput).toBe(4013);
    expect(
      agent.tokensInput +
        agent.tokensCacheWrite +
        agent.tokensCache +
        agent.tokensOutput,
    ).toBe(553306);
  });

  it('hashes Date + Cloud Agent ID + Model + Total Tokens with SHA-256', () => {
    expect(usageRowHash({
      occurredAtKey: '',
      cloudAgentId: '',
      model: '',
      tokensTotal: 0,
    })).toBe(
      '8c1f7b0704f8858e8ccf4611e5d97241f07649d88411906a334a817fe7610d0a',
    );
    const parsed = parseCursorUsageCsv(SAMPLE);
    const row = parsed.rows[2]!;
    expect(row.rowHash).toBe(
      usageRowHash({
        occurredAtKey: '2026-10-17T14:27:59.240Z',
        cloudAgentId: 'bc-ef37ff6f-fc60-57c0-aded-6af2de468404',
        model: 'composer-2.5',
        tokensTotal: 553306,
      }),
    );
    const again = parseCursorUsageCsv(SAMPLE);
    expect(again.rows.map((item) => item.rowHash)).toEqual(
      parsed.rows.map((item) => item.rowHash),
    );
  });

  it('skips rows with no token data and reports only malformed rows as errors', () => {
    const emptyDefault =
      '"2026-10-17T12:00:00.000Z","","","Included","grok-bot-default","No","","","","","","Free"';
    const emptyAutomation =
      '"2026-10-16T08:00:00.000Z","","","Included","grok-bot-automation","No","","","","","","Free"';
    const malformed =
      '"2026-10-17T01:00:00.000Z","","","Included","grok-bot-default","No","nope","2","1","1","4","Free"';
    const badDate =
      '"not-a-date","","","Included","m","Maybe","1","1","1","1","4","Free"';
    const parsed = parseCursorUsageCsv(
      [SAMPLE, emptyDefault, emptyAutomation, malformed, badDate].join('\n'),
    );
    expect(parsed.rows).toHaveLength(4);
    expect(parsed.rowCountNoTokens).toBe(2);
    expect(parsed.errors.map((error) => error.message)).toEqual([
      'Input (w/ Cache Write) must be a whole number',
      'Date must be an ISO datetime',
    ]);
    expect(parsed.errors[0]?.rowNumber).toBe(8);
    const stats = previewUsageImport({
      rows: parsed.rows,
      errors: parsed.errors,
      rowCountNoTokens: parsed.rowCountNoTokens,
      existingHashes: new Set(),
      taskIdByCloudAgentId: new Map(),
    });
    expect(stats.rowCountTotal).toBe(8);
    expect(stats.rowCountNoTokens).toBe(2);
    expect(stats.rowCountErrors).toBe(2);
    expect(stats.rowCountInserted).toBe(4);
    expect(stats.totals.tokensTotal).toBe(62363 + 157554 + 553306 + 821653);
  });

  it('rejects a header that is not the Cursor export', () => {
    expect(() => parseCursorUsageCsv('a,b\n1,2\n')).toThrow(/CSV header/);
    expect(() => parseUsageSource('cursor_admin_api', SAMPLE)).toThrow(
      /not available/,
    );
  });
});

describe('usage dedupe and linking', () => {
  const parsed = parseCursorUsageCsv(SAMPLE);

  it('skips a repeated key inside one file and against stored hashes', () => {
    const repeated = parseCursorUsageCsv(`${SAMPLE}\n${SAMPLE.split('\n')[1]}`);
    const existing = new Set([parsed.rows[0]!.rowHash]);
    const deduped = dedupeUsageRows(repeated.rows, existing);
    expect(deduped.duplicateCount).toBe(2);
    expect(deduped.fresh).toHaveLength(3);
    expect(deduped.fresh.map((row) => row.rowHash)).not.toContain(
      parsed.rows[0]!.rowHash,
    );
  });

  it('links rows only when a task owns that cloud agent id', () => {
    const taskId = '11111111-1111-4111-8111-111111111111';
    const linked = linkUsageRows(parsed.rows, new Map([[parsed.rows[2]!.cloudAgentId!, taskId]]));
    expect(linked[0]?.projectTaskId).toBeNull();
    expect(linked[2]?.projectTaskId).toBe(taskId);
    expect(linked[3]?.projectTaskId).toBe(taskId);
  });

  it('previews file totals and how many rows match a task', () => {
    const taskId = '11111111-1111-4111-8111-111111111111';
    const stats = previewUsageImport({
      rows: parsed.rows,
      errors: [],
      rowCountNoTokens: 0,
      existingHashes: new Set([parsed.rows[0]!.rowHash]),
      taskIdByCloudAgentId: new Map([[parsed.rows[2]!.cloudAgentId!, taskId]]),
    });
    expect(stats.rowCountTotal).toBe(4);
    expect(stats.rowCountDuplicate).toBe(1);
    expect(stats.rowCountInserted).toBe(3);
    expect(stats.rowCountLinked).toBe(2);
    expect(stats.dateFrom).toBe('2026-10-17T13:24:00.025Z');
    expect(stats.dateTo).toBe('2026-10-17T14:52:56.907Z');
    expect(stats.models.map((model) => model.model)).toEqual([
      'composer-2.5',
      'grok-bot-default',
    ]);
    expect(stats.totals.tokensTotal).toBe(62363 + 157554 + 553306 + 821653);
  });

  it('aggregates linked rows once, using the latest model and max mode', () => {
    const rows = parsed.rows.filter((row) => row.cloudAgentId);
    const withMax = { ...rows[0]!, maxMode: true, occurredAt: new Date('2026-10-18T00:00:00.000Z') };
    const aggregate = aggregateLinkedUsage([...rows, withMax]);
    expect(aggregate).not.toBe('overflow');
    if (aggregate === 'overflow' || aggregate == null) return;
    expect(aggregate.tokensInput).toBe(77552 + 7804 + 77552);
    expect(aggregate.tokensCacheWrite).toBe(0);
    expect(aggregate.tokensUsed).toBe(
      aggregate.tokensInput +
        aggregate.tokensCacheWrite +
        aggregate.tokensCache +
        aggregate.tokensOutput,
    );
    expect(aggregate.modelId).toBe('composer-2.5');
    expect(aggregate.pricingTier).toBe('max');
    expect(aggregate.billingPeriod).toBe('2026-10');
    expect(aggregateLinkedUsage([])).toBeNull();
  });
});
