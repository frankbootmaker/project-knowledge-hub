import { describe, expect, it } from 'vitest';
import { DEFAULT_AI_MODEL_PRICES } from './ai-model-price.js';
import {
  modelRatesToCsv,
  modelRatesToJson,
  planModelRateImport,
} from './ai-model-rate-import.js';

const HEADERS = [
  'pattern',
  'input_per_million',
  'output_per_million',
  'cache_read_per_million',
  'cache_write_per_million',
  'blended_per_million',
  'currency',
  'effective_from',
  'source_note',
  'unit',
].join(',');

function line(pattern: string, input: string, note = 'https://docs.x.ai/docs/models'): string {
  return [
    pattern,
    input,
    '15',
    '0.75',
    '3.75',
    input,
    'USD',
    '2026-01-01',
    note,
    'per_1m_tokens',
  ].join(',');
}

describe('model rate import', () => {
  const existing = DEFAULT_AI_MODEL_PRICES.filter((row) => row.model === '*grok*').map((row) => ({
    ...row,
    sourceNote: 'https://docs.x.ai/docs/models',
  }));

  it('previews added, changed, and unchanged and writes nothing when invalid', () => {
    const csv = [
      HEADERS,
      line('*grok*', '3'),
      line('*grok-high*', '4', 'https://cursor.com/docs/models'),
      line('cursor-grok-4.5-high', '5'),
    ].join('\n');
    const changed = planModelRateImport(existing, csv.replace('*grok*,3,', '*grok*,8,'), 'csv');
    expect(changed.errors).toEqual([]);
    expect(changed.changed.map((row) => row.after.model)).toEqual(['*grok*']);
    expect(changed.added.map((row) => row.model)).toEqual([
      '*grok-high*',
      'cursor-grok-4.5-high',
    ]);
    expect(changed.writable).toHaveLength(3);

    const same = planModelRateImport(existing, [HEADERS, line('*grok*', '3')].join('\n'), 'csv');
    expect(same.unchanged).toHaveLength(1);
    expect(same.added).toEqual([]);
    expect(same.changed).toEqual([]);
    expect(same.writable).toEqual([]);

    const badUnit = planModelRateImport(
      existing,
      [HEADERS, line('*grok*', '3').replace('per_1m_tokens', 'per_1k')].join('\n'),
      'csv',
    );
    expect(badUnit.writable).toEqual([]);
    expect(badUnit.errors.some((error) => error.field === 'unit')).toBe(true);

    const missingSource = planModelRateImport(
      existing,
      [HEADERS, line('new-model', '1', '')].join('\n'),
      'csv',
    );
    expect(missingSource.writable).toEqual([]);
    expect(missingSource.errors.some((error) => error.field === 'sourceNote')).toBe(true);
  });

  it('accepts JSON with an explicit per-1M unit and round-trips export', () => {
    const json = modelRatesToJson(existing);
    const plan = planModelRateImport(existing, json, 'json');
    expect(plan.errors).toEqual([]);
    expect(plan.unchanged).toHaveLength(1);
    expect(plan.writable).toEqual([]);
    const csv = modelRatesToCsv(existing);
    expect(csv.split('\n')[0]).toBe(HEADERS);
    expect(csv).toContain('per_1m_tokens');
    expect(planModelRateImport([], json, 'json').added).toHaveLength(1);
    expect(planModelRateImport(existing, '{', 'json').errors[0]?.field).toBe('file');
  });
});
