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

  it('includes project charter, meeting minutes, and decision-making', () => {
    for (const value of [
      'project-charter',
      'meeting-minutes',
      'decision',
    ] as const) {
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

  it('buildKnowledgeRecordMetadata update guide matches update schema', () => {
    const meta = buildKnowledgeRecordMetadata();
    
    // PRO-T-4: update guide required fields should match update_knowledge_record schema
    expect(meta.updateKnowledgeRecord.requiredFields).toEqual([
      'recordId',
      'changeMessage',
    ]);
    
    // PRO-T-4: update guide should include archived in optional fields
    expect(meta.updateKnowledgeRecord.optionalFields).toContain('archived');
    
    // PRO-T-4: recordId should be documented in fields
    const recordIdField = meta.updateKnowledgeRecord.fields.find(
      (f) => f.name === 'recordId',
    );
    expect(recordIdField).toBeDefined();
    expect(recordIdField?.requirement).toBe('required');
    expect(recordIdField?.appliesTo).toContain('update');
    
    // PRO-T-4: archived should be documented in fields
    const archivedField = meta.updateKnowledgeRecord.fields.find(
      (f) => f.name === 'archived',
    );
    expect(archivedField).toBeDefined();
    expect(archivedField?.requirement).toBe('optional');
    expect(archivedField?.appliesTo).toContain('update');
    
    // PRO-T-4: title, recordType, contentMarkdown should be optional on update
    for (const fieldName of ['title', 'recordType', 'contentMarkdown']) {
      const field = meta.updateKnowledgeRecord.fields.find(
        (f) => f.name === fieldName,
      );
      expect(field).toBeDefined();
      expect(field?.requirement).toBe('optional');
      expect(field?.appliesTo).toContain('update');
    }
    
    // PRO-T-4: field requirements should match requiredFields/optionalFields lists
    for (const field of meta.updateKnowledgeRecord.fields) {
      if (field.requirement === 'required') {
        expect(meta.updateKnowledgeRecord.requiredFields).toContain(field.name);
      } else if (field.requirement === 'optional') {
        expect(meta.updateKnowledgeRecord.optionalFields).toContain(field.name);
      }
    }
  });

  it('buildKnowledgeRecordMetadata create guide requirement values are correct', () => {
    const meta = buildKnowledgeRecordMetadata();
    
    // Create guide: title, recordType, contentMarkdown should be required
    for (const fieldName of ['title', 'recordType', 'contentMarkdown']) {
      const field = meta.createKnowledgeRecord.fields.find(
        (f) => f.name === fieldName,
      );
      expect(field).toBeDefined();
      expect(field?.requirement).toBe('required');
      expect(field?.appliesTo).toContain('create');
    }
    
    // Field requirements should match requiredFields/optionalFields lists
    for (const field of meta.createKnowledgeRecord.fields) {
      if (field.requirement === 'required') {
        expect(meta.createKnowledgeRecord.requiredFields).toContain(field.name);
      } else if (field.requirement === 'optional') {
        expect(meta.createKnowledgeRecord.optionalFields).toContain(field.name);
      }
    }
  });
});
