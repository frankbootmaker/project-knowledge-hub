import { describe, expect, it, vi } from 'vitest';
import {
  appendRecordContentInputSchema,
  beginRecordContentUploadInputSchema,
  finalizeRecordContentUploadInputSchema,
  updateKnowledgeRecordInputSchema,
} from '@project-knowledge-hub/domain';
import { MCP_KNOWLEDGE_LIST_LIMIT, MCP_MAX_LIST_LIMIT } from './limits.js';
import {
  describeHubTool,
  findLlmTool,
  invokeNamedHubTool,
  listHubToolSummaries,
} from './llm-tool-catalog.js';
import { zodObjectToToolSchema } from './zod-tool-schema.js';

function keysOf(schema: { shape: Record<string, unknown> }): string[] {
  return Object.keys(schema.shape).sort();
}

describe('knowledge record schema source', () => {
  it('derives catalog update fields from the Zod schema, including translationGroupId', () => {
    const tool = findLlmTool('update_knowledge_record');
    const derived = zodObjectToToolSchema(updateKnowledgeRecordInputSchema);
    expect(Object.keys(tool?.body.properties ?? {}).sort()).toEqual(
      Object.keys(derived.properties ?? {}).sort(),
    );
    expect(keysOf(updateKnowledgeRecordInputSchema)).toEqual(
      Object.keys(derived.properties ?? {}).sort(),
    );
    expect(derived.properties).toHaveProperty('translationGroupId');
    expect(derived.properties).toHaveProperty('expectSha256');
    expect(derived.required).toEqual(['recordId', 'changeMessage']);
  });

  it('keeps list_knowledge_records at 50 and other lists at 25', () => {
    expect(MCP_MAX_LIST_LIMIT).toBe(25);
    expect(MCP_KNOWLEDGE_LIST_LIMIT).toBe(50);
    const list = findLlmTool('list_knowledge_records');
    const limit = (list?.body.properties as { limit?: { maximum?: number } } | undefined)?.limit;
    expect(limit?.maximum).toBe(MCP_KNOWLEDGE_LIST_LIMIT);
    expect(list?.defaults).toMatchObject({ limit: 50 });
    expect(list?.body.properties).toHaveProperty('cursor');
    const tasks = findLlmTool('list_project_tasks');
    const taskLimit = (tasks?.body.properties as { limit?: { maximum?: number } } | undefined)
      ?.limit;
    expect(taskLimit?.maximum).toBe(25);
  });

  it('documents inverse relation names', () => {
    for (const name of [
      'get_knowledge_record_relations',
      'set_knowledge_record_relations',
    ] as const) {
      const description = findLlmTool(name)?.description ?? '';
      expect(description).toContain('source_for');
      expect(description).toContain('required_by');
      expect(description).toContain('canonicalType');
      expect(description).toContain('direction');
    }
  });
});

describe('OAuth schema discovery', () => {
  const scopes = ['projects:read', 'knowledge:write'];

  it('returns the input schema from describe_hub_tool and list_hub_tools {name}', async () => {
    expect(listHubToolSummaries(true).map((tool) => tool.name)).toContain('describe_hub_tool');
    const described = await invokeNamedHubTool({}, scopes, 'describe_hub_tool', {
      name: 'begin_record_content_upload',
    });
    const listed = await invokeNamedHubTool({}, scopes, 'list_hub_tools', {
      name: 'begin_record_content_upload',
    });
    expect(listed).toEqual(described);
    const schema = described as {
      inputSchema: { properties: Record<string, unknown>; required?: string[] };
      allowed: string[];
      required: string[];
    };
    expect(schema.required).toEqual(['recordId']);
    expect(schema.allowed).toContain('changeMessage');
    expect(schema.inputSchema.properties).toHaveProperty('changeMessage');
    expect(schema.inputSchema.properties).not.toHaveProperty('contentMarkdown');
  });

  it('hides write-tool schemas without a write scope', () => {
    expect(() => describeHubTool('update_knowledge_record', false)).toThrow(/Unknown tool/);
    expect(describeHubTool('get_knowledge_record', false).name).toBe('get_knowledge_record');
  });

  it('lists allowed and required fields when a chunk field is wrong', async () => {
    await expect(
      invokeNamedHubTool(
        { beginRecordContentUpload: vi.fn() },
        scopes,
        'begin_record_content_upload',
        { recordId: 'HL1-VIS-2', changeMessage: 'draft body' },
      ),
    ).resolves.toBeUndefined();

    await expect(
      invokeNamedHubTool({ appendRecordContent: vi.fn() }, scopes, 'append_record_content', {
        uploadId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        contentMarkdown: '# no',
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringContaining('Unknown field: contentMarkdown'),
    });
    await expect(
      invokeNamedHubTool({ appendRecordContent: vi.fn() }, scopes, 'append_record_content', {
        uploadId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        contentMarkdown: '# no',
      }),
    ).rejects.toThrow(/Allowed fields: uploadId, chunk, index/);

    await expect(
      invokeNamedHubTool(
        { finalizeRecordContentUpload: vi.fn() },
        scopes,
        'finalize_record_content_upload',
        {},
      ),
    ).rejects.toThrow(/Missing required field: uploadId/);
    await expect(
      invokeNamedHubTool(
        { finalizeRecordContentUpload: vi.fn() },
        scopes,
        'finalize_record_content_upload',
        {},
      ),
    ).rejects.toThrow(/Required fields: uploadId/);
  });

  it('completes begin, append, and finalize from discovered schemas only', async () => {
    const begin = describeHubTool('begin_record_content_upload', true);
    const append = describeHubTool('append_record_content', true);
    const finalize = describeHubTool('finalize_record_content_upload', true);
    expect([...begin.allowed].sort()).toEqual(keysOf(beginRecordContentUploadInputSchema));
    expect([...append.allowed].sort()).toEqual(keysOf(appendRecordContentInputSchema));
    expect([...finalize.allowed].sort()).toEqual(keysOf(finalizeRecordContentUploadInputSchema));
    expect(finalize.required).not.toContain('changeMessage');

    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const handlers = {
      beginRecordContentUpload: vi.fn(async (args: Record<string, unknown>) => {
        calls.push({ name: 'begin', args });
        return { uploadId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' };
      }),
      appendRecordContent: vi.fn(async (args: Record<string, unknown>) => {
        calls.push({ name: 'append', args });
        return { chunkCount: 1 };
      }),
      finalizeRecordContentUpload: vi.fn(async (args: Record<string, unknown>) => {
        calls.push({ name: 'finalize', args });
        return { knowledgeRecord: { id: 'draft' } };
      }),
    };

    const beginArgs: Record<string, unknown> = {};
    if (begin.required.includes('recordId')) beginArgs.recordId = 'HL1-VIS-2';
    if (begin.allowed.includes('changeMessage')) beginArgs.changeMessage = 'chunked update';
    await invokeNamedHubTool(handlers, scopes, 'begin_record_content_upload', beginArgs);

    const uploadId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const appendArgs: Record<string, unknown> = {};
    if (append.required.includes('uploadId')) appendArgs.uploadId = uploadId;
    if (append.required.includes('chunk')) appendArgs.chunk = '# Body\n';
    expect(append.allowed).not.toContain('contentMarkdown');
    await invokeNamedHubTool(handlers, scopes, 'append_record_content', appendArgs);

    const finalizeArgs: Record<string, unknown> = {};
    if (finalize.required.includes('uploadId')) finalizeArgs.uploadId = uploadId;
    if (finalize.required.includes('changeMessage')) {
      finalizeArgs.changeMessage = 'should not be required';
    }
    await invokeNamedHubTool(handlers, scopes, 'finalize_record_content_upload', finalizeArgs);

    expect(calls.map((call) => call.name)).toEqual(['begin', 'append', 'finalize']);
    expect(calls[0]?.args).toMatchObject({
      recordId: 'HL1-VIS-2',
      changeMessage: 'chunked update',
    });
    expect(calls[1]?.args).toMatchObject({ uploadId, chunk: '# Body\n' });
    expect(calls[1]?.args).not.toHaveProperty('contentMarkdown');
    expect(calls[2]?.args).toEqual({ uploadId });
    expect(calls[2]?.args).not.toHaveProperty('changeMessage');
  });
});
