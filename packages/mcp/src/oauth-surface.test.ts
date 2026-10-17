import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  createKnowledgeHubMcpServer,
  type McpClientContext,
  type McpToolHandlers,
} from './server.js';

const client: McpClientContext = {
  id: 'client',
  name: 'Client',
  organizationId: 'org',
  scopes: ['knowledge:read'],
  allowedWorkspaceIds: [],
  allowedProjectIds: [],
  actingUserId: null,
};

describe('oauth tool surface', () => {
  it('adds profile metadata and security schemes only for the OAuth server', () => {
    const handlers = {} as McpToolHandlers;
    const bearer = createKnowledgeHubMcpServer(client, handlers);
    const oauth = createKnowledgeHubMcpServer(client, handlers, {
      oauth: {
        resourceMetadataUrl:
          'https://knowledge.example.com/.well-known/oauth-protected-resource/mcp/oauth',
        profile: { id: 'user-1', name: 'Ada', email: 'ada@example.com' },
      },
    });
    const bearerTools = (
      bearer as unknown as { _registeredTools: Record<string, { _meta?: Record<string, unknown> }> }
    )._registeredTools;
    const oauthTools = (
      oauth as unknown as { _registeredTools: Record<string, { _meta?: Record<string, unknown> }> }
    )._registeredTools;
    expect(bearerTools.get_profile).toBeUndefined();
    expect(bearerTools.list_workspaces?._meta?.securitySchemes).toBeUndefined();
    expect(oauthTools.get_profile?._meta?.['openai/profile']).toBe(true);
    expect(oauthTools.list_workspaces?._meta?.securitySchemes).toEqual([
      { type: 'oauth2', scopes: ['knowledge:read'] },
    ]);
    expect(bearerTools.update_system).toBeDefined();
  });

  it('keeps the ChatGPT tool list under the scan limit', async () => {
    const handlers = {} as McpToolHandlers;
    const oauth = createKnowledgeHubMcpServer(client, handlers, {
      oauth: {
        resourceMetadataUrl:
          'https://knowledge.example.com/.well-known/oauth-protected-resource/mcp/oauth',
        profile: { id: 'user-1', name: 'Ada', email: 'ada@example.com' },
      },
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await oauth.connect(serverTransport);
    const mcp = new Client({ name: 'size', version: '0' });
    await mcp.connect(clientTransport);
    const listed = await mcp.listTools();
    const names = listed.tools.map((tool) => tool.name).sort();
    expect(names).toEqual([
      'call_hub_tool',
      'get_knowledge_record',
      'get_profile',
      'get_project',
      'list_hub_tools',
      'list_projects',
      'list_workspaces',
      'search_knowledge',
    ]);
    expect(names).not.toContain('get_workspace_media');
    const record = listed.tools.find((tool) => tool.name === 'get_knowledge_record');
    expect(record?.description).toMatch(/get_workspace_media/);
    expect(record?.description).toMatch(/call_hub_tool/);
    expect(JSON.stringify(listed.tools).length).toBeLessThan(12_000);
    await mcp.close();
  });

  it('invokes a hidden tool through call_hub_tool', async () => {
    const calls: unknown[] = [];
    const handlers = {
      createProjectTask: async (input: unknown) => {
        calls.push(input);
        return { id: 'task-1' };
      },
    } as McpToolHandlers;
    const oauth = createKnowledgeHubMcpServer(
      { ...client, scopes: ['projects:read', 'pm:write'] },
      handlers,
      {
        oauth: {
          resourceMetadataUrl:
            'https://knowledge.example.com/.well-known/oauth-protected-resource/mcp/oauth',
          profile: { id: 'user-1', name: 'Ada', email: 'ada@example.com' },
        },
      },
    );
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await oauth.connect(serverTransport);
    const mcp = new Client({ name: 'dispatch', version: '0' });
    await mcp.connect(clientTransport);
    const result = await mcp.callTool({
      name: 'call_hub_tool',
      arguments: {
        toolName: 'create_project_task',
        arguments: { projectId: '11111111-1111-4111-8111-111111111111', title: 'Write the brief' },
      },
    });
    expect(result.isError).toBeFalsy();
    expect(calls).toEqual([
      { projectId: '11111111-1111-4111-8111-111111111111', title: 'Write the brief' },
    ]);
    await mcp.close();
  });

  it('asks ChatGPT to reauthenticate only when the grant lacks the scope', async () => {
    const oauthOptions = {
      oauth: {
        resourceMetadataUrl:
          'https://knowledge.example.com/.well-known/oauth-protected-resource/mcp/oauth',
        profile: { id: 'user-1', name: 'Ada', email: 'ada@example.com' },
      },
    };
    const deniedServer = createKnowledgeHubMcpServer(client, {} as McpToolHandlers, oauthOptions);
    const [deniedClientTransport, deniedServerTransport] = InMemoryTransport.createLinkedPair();
    await deniedServer.connect(deniedServerTransport);
    const deniedClient = new Client({ name: 'auth-hint', version: '0' });
    await deniedClient.connect(deniedClientTransport);
    const denied = await deniedClient.callTool({ name: 'list_workspaces', arguments: {} });
    expect(denied.isError).toBe(true);
    expect(JSON.stringify(denied._meta ?? {})).toContain('mcp/www_authenticate');
    await deniedClient.close();

    const missingServer = createKnowledgeHubMcpServer(
      { ...client, scopes: ['projects:read'] },
      {} as McpToolHandlers,
      oauthOptions,
    );
    const [missingClientTransport, missingServerTransport] = InMemoryTransport.createLinkedPair();
    await missingServer.connect(missingServerTransport);
    const missingClient = new Client({ name: 'auth-hint', version: '0' });
    await missingClient.connect(missingClientTransport);
    const missing = await missingClient.callTool({
      name: 'call_hub_tool',
      arguments: { toolName: 'not_a_tool', arguments: {} },
    });
    expect(missing.isError).toBe(true);
    expect(JSON.stringify(missing._meta ?? {})).not.toContain('mcp/www_authenticate');
    await missingClient.close();
  });
});
