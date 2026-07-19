import { describe, expect, it } from 'vitest';
import {
  RECORD_TYPES,
  RECORD_TYPE_CATALOG,
  buildKnowledgeRecordMetadata,
  recordTypeSchema,
} from './record-types.js';

describe('record types catalog', () => {
  it('includes ledger planning types', () => {
    for (const value of [
      'business-idea',
      'vision',
      'plan',
      'initiative',
      'note',
    ] as const) {
      expect(RECORD_TYPES).toContain(value);
      expect(recordTypeSchema.parse(value)).toBe(value);
    }
  });

  it('keeps catalog values aligned with the enum', () => {
    expect(RECORD_TYPE_CATALOG.map((entry) => entry.value).sort()).toEqual(
      [...RECORD_TYPES].sort(),
    );
  });

  it('buildKnowledgeRecordMetadata documents create fields and MCP constraints', () => {
    const meta = buildKnowledgeRecordMetadata();
    expect(meta.createKnowledgeRecord.requiredFields).toEqual([
      'workspaceId',
      'title',
      'recordType',
      'contentMarkdown',
    ]);
    expect(meta.createKnowledgeRecord.mcpWriteConstraints.sourceOfTruthMode).toBe(
      'ai_generated_draft',
    );
    expect(meta.recordTypes.some((entry) => entry.value === 'vision')).toBe(true);
  });
});
