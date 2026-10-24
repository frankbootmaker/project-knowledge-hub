import { describe, expect, it } from 'vitest';
import {
  escapeIlike,
  knowledgeRecordListQuerySchema,
  knowledgeRecordSearchPattern,
} from './knowledge-record-list-query.js';

const workspaceId = '11111111-1111-4111-8111-111111111111';

describe('knowledgeRecordListQuerySchema', () => {
  it('keeps an unpaged catalogue list when limit is omitted', () => {
    const parsed = knowledgeRecordListQuerySchema.parse({ workspaceId });
    expect(parsed.limit).toBeUndefined();
    expect(parsed.offset).toBeUndefined();
    expect(parsed.q).toBeUndefined();
    expect(parsed.excludeIds).toEqual([]);
    expect(parsed.workspaceLevel).toBe(false);
    expect(parsed.includeArchived).toBe(false);
  });

  it('parses picker search, type, page, and exclusions', () => {
    const exclude = [
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
    ];
    const parsed = knowledgeRecordListQuerySchema.parse({
      workspaceId,
      q: '  plan  ',
      recordType: 'note',
      limit: '5',
      offset: '10',
      excludeIds: exclude.join(','),
      workspaceLevel: 'true',
    });
    expect(parsed.q).toBe('plan');
    expect(parsed.recordType).toBe('note');
    expect(parsed.limit).toBe(5);
    expect(parsed.offset).toBe(10);
    expect(parsed.excludeIds).toEqual(exclude);
    expect(parsed.workspaceLevel).toBe(true);
  });

  it('rejects a page size, offset, type, or exclude list the picker must not send', () => {
    expect(() =>
      knowledgeRecordListQuerySchema.parse({ workspaceId, limit: '0' }),
    ).toThrow();
    expect(() =>
      knowledgeRecordListQuerySchema.parse({ workspaceId, limit: '51' }),
    ).toThrow();
    expect(() =>
      knowledgeRecordListQuerySchema.parse({ workspaceId, offset: '-1' }),
    ).toThrow();
    expect(() =>
      knowledgeRecordListQuerySchema.parse({ workspaceId, recordType: 'nope' }),
    ).toThrow();
    expect(() =>
      knowledgeRecordListQuerySchema.parse({ workspaceId, excludeIds: 'not-a-uuid' }),
    ).toThrow();
    const tooMany = Array.from({ length: 201 }, () => workspaceId).join(',');
    expect(() =>
      knowledgeRecordListQuerySchema.parse({ workspaceId, excludeIds: tooMany }),
    ).toThrow();
  });
});

describe('knowledgeRecordSearchPattern', () => {
  it('wraps the query and escapes ILIKE wildcards', () => {
    expect(escapeIlike('100%_done\\')).toBe('100\\%\\_done\\\\');
    expect(knowledgeRecordSearchPattern('PRJ-NT-1')).toBe('%PRJ-NT-1%');
  });
});
