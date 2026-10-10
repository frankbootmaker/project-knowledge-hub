import { describe, expect, it } from 'vitest';
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
  });
});
