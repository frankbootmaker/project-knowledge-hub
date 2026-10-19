import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, test, vi } from 'vitest';
import { jsonSchemaHasClosedObjects } from './open-output-schema.js';
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

const entry = {
  id: '77777777-7777-4777-8777-777777777777',
  workspaceId: '22222222-2222-4222-8222-222222222222',
  aiSystemId: null,
  period: '2026-10',
  servicePeriodStart: '2026-10-12',
  servicePeriodEnd: '2026-11-11',
  provider: 'Cursor',
  plan: null,
  type: 'subscription',
  amount: 31,
  currency: 'EUR',
  paidAt: null,
  note: null,
  externalRef: null,
  createdAt: '2026-10-12T00:00:00.000Z',
  updatedAt: '2026-10-12T00:00:00.000Z',
};

describe('AI cost entry MCP tools', () => {
  test('input and output include service dates and output stays open', async () => {
    const server = createKnowledgeHubMcpServer(testClient(['pm:read', 'pm:write']), {
      listAiBillingEntries: vi.fn(async () => ({ entries: [entry] })),
      createAiBillingEntry: vi.fn(async () => ({ entry })),
      updateAiBillingEntry: vi.fn(async () => ({ entry })),
    } as Partial<McpToolHandlers> as McpToolHandlers);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'billing-test', version: '0.0.0' });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    try {
      const listed = await client.listTools();
      for (const name of [
        'list_ai_billing_entries',
        'create_ai_billing_entry',
        'update_ai_billing_entry',
      ]) {
        const tool = listed.tools.find((item) => item.name === name);
        const encoded = JSON.stringify(tool);
        expect(encoded, name).toContain('servicePeriodStart');
        expect(encoded, name).toContain('servicePeriodEnd');
        expect(jsonSchemaHasClosedObjects(tool?.outputSchema), name).toBe(false);
      }
      const create = listed.tools.find((item) => item.name === 'create_ai_billing_entry');
      expect(create?.description).toContain('prorate');
      expect(create?.description).toMatch(/exclusive/i);
      expect(create?.description).toMatch(/after start/);
      const update = listed.tools.find((item) => item.name === 'update_ai_billing_entry');
      expect(update?.description).toMatch(/exclusive/i);
      expect(update?.description).toMatch(/after start/);
      const list = listed.tools.find((item) => item.name === 'list_ai_billing_entries');
      expect(list?.description).toMatch(/exclusive/i);
      const required = (create?.inputSchema as { required?: string[] }).required ?? [];
      expect(required).not.toContain('period');
    } finally {
      await client.close();
      await server.close();
    }
  });

  test('create passes service dates and returns them', async () => {
    const createAiBillingEntry = vi.fn(async () => ({ entry }));
    const server = createKnowledgeHubMcpServer(testClient(['pm:write']), {
      createAiBillingEntry,
    } as Partial<McpToolHandlers> as McpToolHandlers);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'billing-test', version: '0.0.0' });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    try {
      const result = await client.callTool({
        name: 'create_ai_billing_entry',
        arguments: {
          workspaceId: entry.workspaceId,
          servicePeriodStart: '2026-10-12',
          servicePeriodEnd: '2026-11-11',
          provider: 'Cursor',
          type: 'subscription',
          amount: 31,
          currency: 'EUR',
        },
      });
      expect(createAiBillingEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          servicePeriodStart: '2026-10-12',
          servicePeriodEnd: '2026-11-11',
        }),
      );
      const text = result.content[0]?.type === 'text' ? result.content[0].text : '';
      expect(text).toContain('2026-10-12');
      expect(text).toContain('2026-11-11');
      expect(result.structuredContent).toMatchObject({ entry });
    } finally {
      await client.close();
      await server.close();
    }
  });
});
