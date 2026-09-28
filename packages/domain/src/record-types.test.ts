import { describe, expect, it } from 'vitest';
import {
  RECORD_TYPES,
  RECORD_TYPE_CATALOG,
  buildKnowledgeRecordMetadata,
  recordTypeSchema,
  createKnowledgeRecordInputSchema,
  updateKnowledgeRecordInputSchema,
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
    
    // PRO-T-4: update guide should include ignored_on_mcp_write fields
    const lifecycleStatusField = meta.updateKnowledgeRecord.fields.find(
      (f) => f.name === 'lifecycleStatus',
    );
    expect(lifecycleStatusField).toBeDefined();
    expect(lifecycleStatusField?.requirement).toBe('ignored_on_mcp_write');
    
    const sourceOfTruthModeField = meta.updateKnowledgeRecord.fields.find(
      (f) => f.name === 'sourceOfTruthMode',
    );
    expect(sourceOfTruthModeField).toBeDefined();
    expect(sourceOfTruthModeField?.requirement).toBe('ignored_on_mcp_write');
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

  it('PRO-T-4: create guide matches createKnowledgeRecordInputSchema', () => {
    const meta = buildKnowledgeRecordMetadata();
    const schemaShape = createKnowledgeRecordInputSchema.shape;
    
    // Fields that are deliberately excluded from the guide
    const excludedFromGuide = new Set<string>([
      // None currently excluded for create
    ]);
    
    // Fields that MCP ignores (documented but not in the tool schema)
    const ignoredOnMcpWrite = new Set<string>([
      'lifecycleStatus',
      'sourceOfTruthMode',
    ]);
    
    // Every schema property should appear in the guide (except excluded or ignored)
    for (const fieldName of Object.keys(schemaShape)) {
      if (excludedFromGuide.has(fieldName)) continue;
      const field = meta.createKnowledgeRecord.fields.find(
        (f) => f.name === fieldName,
      );
      expect(field, `Schema field "${fieldName}" should be in guide fields`).toBeDefined();
      
      // Check required/optional status matches
      const zodField = schemaShape[fieldName as keyof typeof schemaShape];
      const isOptional = zodField.isOptional();
      
      if (isOptional) {
        expect(field?.requirement, `Field "${fieldName}" should be optional`).toBe('optional');
        expect(
          meta.createKnowledgeRecord.optionalFields,
          `Optional field "${fieldName}" should be in optionalFields list`,
        ).toContain(fieldName);
      } else {
        expect(field?.requirement, `Field "${fieldName}" should be required`).toBe('required');
        expect(
          meta.createKnowledgeRecord.requiredFields,
          `Required field "${fieldName}" should be in requiredFields list`,
        ).toContain(fieldName);
      }
    }
    
    // Every guide field with requirement required/optional should exist in schema or be ignored
    for (const field of meta.createKnowledgeRecord.fields) {
      if (field.requirement === 'ignored_on_mcp_write') {
        expect(
          ignoredOnMcpWrite.has(field.name),
          `Ignored field "${field.name}" should be in ignoredOnMcpWrite set`,
        ).toBe(true);
        continue;
      }
      
      expect(
        schemaShape,
        `Guide field "${field.name}" should exist in schema`,
      ).toHaveProperty(field.name);
    }
  });

  it('PRO-T-4: update guide matches updateKnowledgeRecordInputSchema', () => {
    const meta = buildKnowledgeRecordMetadata();
    const schemaShape = updateKnowledgeRecordInputSchema.shape;
    
    // Fields that are deliberately excluded from the guide
    const excludedFromGuide = new Set<string>([
      // None currently excluded for update
    ]);
    
    // Fields that MCP ignores (documented but not in the tool schema)
    const ignoredOnMcpWrite = new Set<string>([
      'lifecycleStatus',
      'sourceOfTruthMode',
    ]);
    
    // Every schema property should appear in the guide (except excluded or ignored)
    for (const fieldName of Object.keys(schemaShape)) {
      if (excludedFromGuide.has(fieldName)) continue;
      const field = meta.updateKnowledgeRecord.fields.find(
        (f) => f.name === fieldName,
      );
      expect(field, `Schema field "${fieldName}" should be in guide fields`).toBeDefined();
      
      // Check required/optional status matches
      const zodField = schemaShape[fieldName as keyof typeof schemaShape];
      const isOptional = zodField.isOptional();
      
      if (isOptional) {
        expect(field?.requirement, `Field "${fieldName}" should be optional`).toBe('optional');
        expect(
          meta.updateKnowledgeRecord.optionalFields,
          `Optional field "${fieldName}" should be in optionalFields list`,
        ).toContain(fieldName);
      } else {
        expect(field?.requirement, `Field "${fieldName}" should be required`).toBe('required');
        expect(
          meta.updateKnowledgeRecord.requiredFields,
          `Required field "${fieldName}" should be in requiredFields list`,
        ).toContain(fieldName);
      }
    }
    
    // Every guide field with requirement required/optional should exist in schema or be ignored
    for (const field of meta.updateKnowledgeRecord.fields) {
      if (field.requirement === 'ignored_on_mcp_write') {
        expect(
          ignoredOnMcpWrite.has(field.name),
          `Ignored field "${field.name}" should be in ignoredOnMcpWrite set`,
        ).toBe(true);
        continue;
      }
      
      expect(
        schemaShape,
        `Guide field "${field.name}" should exist in schema`,
      ).toHaveProperty(field.name);
    }
  });
});
