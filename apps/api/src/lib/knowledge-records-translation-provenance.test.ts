import { describe, expect, it } from 'vitest';
import {
  createRecordInputSchema,
  createTranslationInputSchema,
} from './knowledge-records-service.js';

/**
 * Regression tests for PRO-T-12: MCP-created translations must record MCP/AI provenance.
 * These tests verify the schema accepts the required fields.
 */

describe('createTranslationInputSchema provenance fields (PRO-T-12)', () => {
  it('accepts sourceOfTruthMode parameter', () => {
    const result = createTranslationInputSchema.safeParse({
      language: 'hu',
      sourceOfTruthMode: 'ai_generated_draft',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sourceOfTruthMode).toBe('ai_generated_draft');
    }
  });

  it('accepts source parameter with MCP provenance', () => {
    const result = createTranslationInputSchema.safeParse({
      language: 'de',
      source: {
        sourceType: 'conversation',
        sourceProvider: 'mcp',
        sourceTitle: 'Created via MCP',
        generatedByModel: 'gpt-4',
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.source).toMatchObject({
        sourceType: 'conversation',
        sourceProvider: 'mcp',
        generatedByModel: 'gpt-4',
      });
    }
  });

  it('works without sourceOfTruthMode or source (REST/user path)', () => {
    const result = createTranslationInputSchema.safeParse({
      language: 'fr',
      title: 'Titre français',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sourceOfTruthMode).toBeUndefined();
      expect(result.data.source).toBeUndefined();
    }
  });

  it('MCP translation schema matches create_knowledge_record schema shape', () => {
    // Both schemas should accept the same source structure
    const mcpSource = {
      sourceType: 'conversation' as const,
      sourceProvider: 'mcp',
      sourceTitle: 'Created via MCP',
      generatedByModel: 'claude-opus-4',
    };

    const createResult = createRecordInputSchema.safeParse({
      workspaceId: '00000000-0000-0000-0000-000000000000',
      title: 'Test',
      recordType: 'note',
      contentMarkdown: 'Test content',
      sourceOfTruthMode: 'ai_generated_draft',
      source: mcpSource,
    });

    const translateResult = createTranslationInputSchema.safeParse({
      language: 'hu',
      sourceOfTruthMode: 'ai_generated_draft',
      source: mcpSource,
    });

    expect(createResult.success).toBe(true);
    expect(translateResult.success).toBe(true);

    if (createResult.success && translateResult.success) {
      // Both should parse the same source structure
      expect(translateResult.data.source).toMatchObject({
        sourceType: mcpSource.sourceType,
        sourceProvider: mcpSource.sourceProvider,
        generatedByModel: mcpSource.generatedByModel,
      });
      expect(createResult.data.source).toMatchObject({
        sourceType: mcpSource.sourceType,
        sourceProvider: mcpSource.sourceProvider,
        generatedByModel: mcpSource.generatedByModel,
      });
    }
  });
});
