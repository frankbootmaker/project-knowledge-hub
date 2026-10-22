import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, test, vi } from 'vitest';
import { AI_MODEL_PRICE_SOURCE_GUIDE } from '@project-knowledge-hub/domain';
import {
  createKnowledgeHubMcpServer,
  type McpClientContext,
  type McpToolHandlers,
} from './server.js';

function testClient(scopes: string[]): McpClientContext {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'test-client',
    organizationId: '00000000-0000-4000-8000-000000000002',
    scopes,
    allowedWorkspaceIds: [],
    allowedProjectIds: [],
    actingUserId: null,
  };
}

const price = {
  scope: 'workspace' as const,
  workspaceId: '22222222-2222-4222-8222-222222222222',
  model: 'cursor-grok-4.5-high',
  inputPerMillion: 3,
  outputPerMillion: 15,
  cacheReadPerMillion: 0.75,
  cacheWritePerMillion: 3.75,
  blendedPerMillion: 3,
  currency: 'USD',
  effectiveFrom: '2026-01-01',
  sourceNote: 'https://docs.x.ai/docs/models',
};

describe('AI model price MCP tools', () => {
  test('descriptions name the provider price pages and the per-1M unit', async () => {
    const server = createKnowledgeHubMcpServer(testClient(['pm:read', 'pm:write']), {
      listAiModelPrices: vi.fn(async () => ({ prices: [] })),
      upsertAiModelPrice: vi.fn(async () => ({ price })),
      retireAiModelPrice: vi.fn(async () => ({ price })),
    } as Partial<McpToolHandlers> as McpToolHandlers);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'price-test', version: '0.0.0' });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    try {
      const listed = await client.listTools();
      for (const name of ['list_ai_model_prices', 'upsert_ai_model_price', 'retire_ai_model_price']) {
        const tool = listed.tools.find((item) => item.name === name);
        expect(tool?.description, name).toContain('https://docs.x.ai/docs/models');
        expect(tool?.description, name).toContain('https://cursor.com/docs/models');
        expect(tool?.description, name).toContain('1,000,000');
        expect(tool?.description, name).toContain('platform administrator');
      }
      const upsert = listed.tools.find((item) => item.name === 'upsert_ai_model_price');
      expect(upsert?.description).toContain(AI_MODEL_PRICE_SOURCE_GUIDE);
      const required = (upsert?.inputSchema as { required?: string[] }).required ?? [];
      expect(required).toContain('sourceNote');
      expect(required).toContain('effectiveFrom');
      expect(required).toContain('blendedPerMillion');
    } finally {
      await client.close();
      await server.close();
    }
  });

  test('pm:read cannot upsert, and a price without a source is rejected', async () => {
    const upsertAiModelPrice = vi.fn(async () => ({ price }));
    const server = createKnowledgeHubMcpServer(testClient(['pm:read']), {
      upsertAiModelPrice,
    } as Partial<McpToolHandlers> as McpToolHandlers);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'price-test', version: '0.0.0' });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    try {
      const denied = await client.callTool({
        name: 'upsert_ai_model_price',
        arguments: price,
      });
      expect(denied.isError).toBe(true);
      const text = denied.content[0]?.type === 'text' ? denied.content[0].text : '';
      expect(text).toMatch(/pm:write/);
      expect(upsertAiModelPrice).not.toHaveBeenCalled();
    } finally {
      await client.close();
      await server.close();
    }

    const writer = vi.fn(async () => ({ price }));
    const writeServer = createKnowledgeHubMcpServer(testClient(['pm:write']), {
      upsertAiModelPrice: writer,
    } as Partial<McpToolHandlers> as McpToolHandlers);
    const [writeClientTransport, writeServerTransport] = InMemoryTransport.createLinkedPair();
    const writeClient = new Client({ name: 'price-test', version: '0.0.0' });
    await Promise.all([
      writeClient.connect(writeClientTransport),
      writeServer.connect(writeServerTransport),
    ]);
    try {
      const invalid = await writeClient.callTool({
        name: 'upsert_ai_model_price',
        arguments: { ...price, sourceNote: '' },
      });
      expect(invalid.isError).toBe(true);
      expect(writer).not.toHaveBeenCalled();
      const ok = await writeClient.callTool({
        name: 'upsert_ai_model_price',
        arguments: price,
      });
      expect(ok.isError).toBeFalsy();
      expect(writer).toHaveBeenCalledWith(expect.objectContaining({
        scope: 'workspace',
        model: 'cursor-grok-4.5-high',
        sourceNote: 'https://docs.x.ai/docs/models',
        effectiveFrom: '2026-01-01',
      }));
    } finally {
      await writeClient.close();
      await writeServer.close();
    }
  });
});
