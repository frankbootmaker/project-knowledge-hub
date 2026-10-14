import { describe, expect, it } from 'vitest';
import {
  findLlmTool,
  toolDefinitionsForOpenApi,
  unknownToolFields,
} from './llm-tool-catalog.js';

const TOOLS = [
  'list_delivery_dependencies',
  'set_delivery_dependency',
  'remove_delivery_dependency',
] as const;

describe('delivery dependency MCP tools', () => {
  it('keeps the tools off the ChatGPT OpenAPI surface', () => {
    const names = toolDefinitionsForOpenApi(true).map((tool) => tool.name);
    for (const name of TOOLS) {
      expect(names).not.toContain(name);
    }
    expect(names.length).toBeLessThanOrEqual(30);
  });

  it('uses closed object schemas and human-key fields', () => {
    for (const name of TOOLS) {
      const tool = findLlmTool(name);
      expect(tool).toBeTruthy();
      expect(tool?.body.additionalProperties).toBe(false);
      expect(tool?.openApi).toBeUndefined();
    }

    const list = findLlmTool('list_delivery_dependencies');
    expect(list?.scope).toBe('pm:read');
    expect(list?.body.required).toEqual(['projectId', 'entityId']);
    expect(unknownToolFields(list?.body, {
      projectId: '00000000-0000-4000-8000-000000000001',
      entityId: 'PRO-T-1',
      extra: true,
    })).toEqual(['extra']);

    const set = findLlmTool('set_delivery_dependency');
    expect(set?.scope).toBe('pm:write');
    expect(set?.write).toBe(true);
    expect(set?.body.required).toEqual(['projectId']);
    expect(unknownToolFields(set?.body, {
      projectId: '00000000-0000-4000-8000-000000000001',
      predecessorId: 'PRO-T-1',
      successorId: 'PRO-B-1',
      linkType: 'FS',
      successorTitle: 'nope',
    })).toEqual(['successorTitle']);
    expect(unknownToolFields(set?.body, {
      projectId: '00000000-0000-4000-8000-000000000001',
      links: [
        {
          predecessorId: 'PRO-T-1',
          successorId: 'PRO-B-1',
          linkType: 'FS',
          note: 'nope',
        },
      ],
    })).toEqual(['links[0].note']);

    const remove = findLlmTool('remove_delivery_dependency');
    expect(remove?.scope).toBe('pm:write');
    expect(unknownToolFields(remove?.body, {
      projectId: '00000000-0000-4000-8000-000000000001',
      predecessorId: 'PRO-E-1',
      successorId: 'PRO-SP-1',
    })).toEqual([]);
  });
});
