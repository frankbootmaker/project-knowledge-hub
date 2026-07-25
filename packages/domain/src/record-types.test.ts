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

  it('includes Doc Factory summary types', () => {
    for (const value of ['management-summary', 'progress-summary'] as const) {
      expect(RECORD_TYPES).toContain(value);
      expect(recordTypeSchema.parse(value)).toBe(value);
      expect(RECORD_TYPE_CATALOG.some((entry) => entry.value === value)).toBe(true);
    }
  });

  it('includes invoice', () => {
    expect(recordTypeSchema.parse('invoice')).toBe('invoice');
    expect(RECORD_TYPE_CATALOG.some((entry) => entry.value === 'invoice')).toBe(
      true,
    );
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
    expect(meta.workspaceMedia.tools).toContain('upload_workspace_media');
    expect(meta.workspaceMedia.tools).toContain('begin_workspace_media_upload');
    expect(meta.workspaceMedia.preferredPath).toContain('begin_workspace_media_upload');
    expect(meta.workspaceMedia.workflow[0]).toMatch(/begin_workspace_media_upload/);
    expect(meta.workspaceMedia.workflow.some((line) => line.includes('omits upload_workspace_media'))).toBe(
      true,
    );
    expect(meta.workspaceMedia.contentTypes).toContain('image/png');
    expect(
      meta.guidance.some((line) => line.includes('finalize_workspace_media_upload')),
    ).toBe(true);
  });
});
