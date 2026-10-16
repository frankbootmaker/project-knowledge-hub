import { describe, expect, it } from 'vitest';
import {
  findLlmTool,
  toolDefinitionsForOpenApi,
  unknownToolFields,
} from './llm-tool-catalog.js';

const TOOLS = [
  'get_knowledge_record_relations',
  'set_knowledge_record_relations',
] as const;

describe('knowledge record relation MCP tools', () => {
  it('keeps the tools off the ChatGPT OpenAPI surface', () => {
    const names = toolDefinitionsForOpenApi(true).map((tool) => tool.name);
    for (const name of TOOLS) {
      expect(names).not.toContain(name);
    }
    expect(names.length).toBeLessThanOrEqual(30);
  });

  it('validates closed schemas, scopes, and recordRelations on get', () => {
    for (const name of TOOLS) {
      const tool = findLlmTool(name);
      expect(tool).toBeTruthy();
      expect(tool?.body.additionalProperties).toBe(false);
      expect(tool?.output).toBeTruthy();
    }

    const getRecord = findLlmTool('get_knowledge_record');
    expect(getRecord?.description).toContain('recordRelations');
    expect(getRecord?.body.properties).toHaveProperty('includeRecordRelations');
    expect(JSON.stringify(getRecord?.output)).toContain('recordRelations');

    const getRelations = findLlmTool('get_knowledge_record_relations');
    expect(getRelations?.scope).toBe('knowledge:read');
    expect(getRelations?.body.required).toEqual(['recordId']);
    expect(unknownToolFields(getRelations?.body, {
      recordId: 'REL-ARCH-1',
      extra: true,
    })).toEqual(['extra']);

    const setRelations = findLlmTool('set_knowledge_record_relations');
    expect(setRelations?.scope).toBe('knowledge:write');
    expect(setRelations?.write).toBe(true);
    expect(setRelations?.body.required).toEqual(['recordId', 'links']);
    expect(unknownToolFields(setRelations?.body, {
      recordId: 'REL-ARCH-2',
      links: [
        {
          targetRecordId: 'REL-ARCH-1',
          relationType: 'refines',
          note: 'nope',
        },
      ],
    })).toEqual(['links[0].note']);
    expect(unknownToolFields(setRelations?.body, {
      recordId: '11111111-1111-4111-8111-111111111111',
      links: [
        {
          targetRecordId: 'REL-ARCH-1',
          relationType: 'depends_on',
        },
      ],
    })).toEqual([]);
  });
});