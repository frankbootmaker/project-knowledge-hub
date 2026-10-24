import { describe, expect, it, vi } from 'vitest';
import { AppError } from '@project-knowledge-hub/domain';
import { findLlmTool, invokeNamedHubTool, LLM_TOOL_CATALOG } from './llm-tool-catalog.js';
import {
  assertToolInput,
  formatToolInputIssues,
  toolInputIssues,
  type ToolInputSchema,
} from './tool-input.js';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';

describe('shared tool input validation', () => {
  const schema: ToolInputSchema = {
    type: 'object',
    required: ['projectId', 'entityId'],
    properties: {
      projectId: { type: 'string', format: 'uuid', description: 'Required project id (UUID).' },
      entityId: { type: 'string', minLength: 1, maxLength: 80 },
      links: {
        type: 'array',
        maxItems: 50,
        items: {
          type: 'object',
          required: ['predecessorId', 'successorId', 'linkType'],
          properties: {
            predecessorId: { type: 'string', minLength: 1 },
            successorId: { type: 'string', minLength: 1 },
            linkType: { type: 'string', enum: ['FS', 'SS', 'FF', 'SF'] },
          },
        },
      },
    },
  };

  it('names every missing required field', () => {
    const issues = toolInputIssues(schema, {});
    expect(formatToolInputIssues(issues)).toBe('Missing required fields: projectId, entityId');
    expect(issues.map((issue) => issue.field)).toEqual(['projectId', 'entityId']);
  });

  it('names an invalid required uuid and a nested enum', () => {
    expect(() =>
      assertToolInput(schema, {
        projectId: 'not-a-uuid',
        entityId: 'PRO-T-1',
        links: [{ predecessorId: 'PRO-T-1', successorId: 'PRO-B-1', linkType: 'XX' }],
      }),
    ).toThrow(AppError);

    try {
      assertToolInput(schema, {
        projectId: 'not-a-uuid',
        entityId: 'PRO-T-1',
        links: [{ predecessorId: 'PRO-T-1', successorId: 'PRO-B-1', linkType: 'XX' }],
      });
    } catch (error) {
      expect(error).toMatchObject({
        code: 'VALIDATION_ERROR',
        statusCode: 400,
      });
      const message = error instanceof Error ? error.message : '';
      expect(message).toContain('Invalid field projectId: expected a UUID');
      expect(message).toContain('Invalid field links[0].linkType: expected one of FS, SS, FF, SF');
    }
  });

  it('names a missing nested required field', () => {
    const issues = toolInputIssues(schema, {
      projectId: PROJECT_ID,
      entityId: 'PRO-T-1',
      links: [{ predecessorId: 'PRO-T-1', linkType: 'FS' }],
    });
    expect(formatToolInputIssues(issues)).toBe('Missing required field: links[0].successorId');
  });

  it('accepts a complete value and a nullable money amount', () => {
    expect(
      toolInputIssues(schema, {
        projectId: PROJECT_ID,
        entityId: 'PRO-T-1',
      }),
    ).toEqual([]);

    const money: ToolInputSchema = {
      type: 'object',
      properties: {
        amount: {
          oneOf: [{ type: 'number' }, { type: 'string' }],
          nullable: true,
        },
      },
    };
    expect(toolInputIssues(money, { amount: null })).toEqual([]);
    expect(toolInputIssues(money, { amount: '12.5' })).toEqual([]);
    expect(toolInputIssues(money, {})).toEqual([]);
  });

  it('describes every catalog required field as required', () => {
    for (const tool of LLM_TOOL_CATALOG) {
      const required = (tool.body.required ?? []) as string[];
      const properties = (tool.body.properties ?? {}) as Record<string, { description?: string }>;
      for (const field of required) {
        expect(properties[field]?.description, `${tool.name}.${field}`).toMatch(/required/i);
      }
    }
  });
});

describe('missing projectId on hub tools', () => {
  it('rejects list_delivery_dependencies and set_delivery_dependency before the handler', async () => {
    const listDeliveryDependencies = vi.fn();
    const setDeliveryDependency = vi.fn();
    const handlers = { listDeliveryDependencies, setDeliveryDependency };

    await expect(
      invokeNamedHubTool(handlers, ['pm:read'], 'list_delivery_dependencies', {}),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      statusCode: 400,
      message: expect.stringContaining('Missing required fields: projectId, entityId'),
    });
    await expect(
      invokeNamedHubTool(handlers, ['pm:write'], 'set_delivery_dependency', {
        predecessorId: 'PRO-T-1',
        successorId: 'PRO-B-1',
        linkType: 'FS',
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      statusCode: 400,
      message: expect.stringContaining('Missing required field: projectId'),
    });
    expect(listDeliveryDependencies).not.toHaveBeenCalled();
    expect(setDeliveryDependency).not.toHaveBeenCalled();
  });

  it('rejects an invalid projectId on list_project_tasks without calling the handler', async () => {
    const listProjectTasks = vi.fn();
    await expect(
      invokeNamedHubTool({ listProjectTasks }, ['pm:read'], 'list_project_tasks', {
        projectId: 'proj',
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      statusCode: 400,
      message: expect.stringContaining('Invalid field projectId: expected a UUID'),
    });
    expect(listProjectTasks).not.toHaveBeenCalled();
  });

  it('still calls the dependency handlers when projectId is present', async () => {
    const listDeliveryDependencies = vi.fn(async () => ({ predecessors: [] }));
    const setDeliveryDependency = vi.fn(async () => ({ dependency: { id: 'link' } }));
    await invokeNamedHubTool(
      { listDeliveryDependencies },
      ['pm:read'],
      'list_delivery_dependencies',
      { projectId: PROJECT_ID, entityId: 'PRO-T-1' },
    );
    await invokeNamedHubTool({ setDeliveryDependency }, ['pm:write'], 'set_delivery_dependency', {
      projectId: PROJECT_ID,
      predecessorId: 'PRO-T-1',
      successorId: 'PRO-B-1',
      linkType: 'FS',
    });
    expect(listDeliveryDependencies).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      entityId: 'PRO-T-1',
    });
    expect(setDeliveryDependency).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      predecessorId: 'PRO-T-1',
      successorId: 'PRO-B-1',
      linkType: 'FS',
    });
  });

  it('keeps projectId required in the dependency tool schemas', () => {
    const list = findLlmTool('list_delivery_dependencies');
    const set = findLlmTool('set_delivery_dependency');
    expect(list?.description).toMatch(/projectId \(UUID\) and entityId are required/);
    expect(set?.description).toMatch(/projectId \(UUID\) is required/);
    expect(list?.body.required).toEqual(['projectId', 'entityId']);
    expect(set?.body.required).toEqual(['projectId']);
    const listProps = list?.body.properties as Record<string, { description?: string }>;
    const setProps = set?.body.properties as Record<string, { description?: string }>;
    expect(listProps.projectId?.description).toBe('Required project id (UUID).');
    expect(setProps.projectId?.description).toBe('Required project id (UUID).');
  });
});

describe('update_knowledge_record slug', () => {
  it('passes an optional slug through and keeps the description short', async () => {
    const tool = findLlmTool('update_knowledge_record');
    const properties = tool?.body.properties as Record<string, { description?: string }>;
    expect(properties.slug?.description).toBe('URL slug (lowercase a-z, 0-9, hyphens)');
    expect(properties).toHaveProperty('translationGroupId');
    expect(properties).toHaveProperty('expectSha256');
    expect(properties).toHaveProperty('expectedVersion');
    expect(tool?.description).toContain('Optional slug');
    expect(tool?.description).toContain('409 conflict');
    expect(tool?.description).toContain('preservedLiveRecord');

    const updateKnowledgeRecord = vi.fn(async () => ({ ok: true }));
    await invokeNamedHubTool(
      { updateKnowledgeRecord },
      ['knowledge:write'],
      'update_knowledge_record',
      {
        recordId: 'HL1-VIS-2',
        changeMessage: 'rename',
        slug: 'ai-lawyer-notes',
      },
    );
    expect(updateKnowledgeRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        recordId: 'HL1-VIS-2',
        changeMessage: 'rename',
        slug: 'ai-lawyer-notes',
      }),
    );
  });
});
