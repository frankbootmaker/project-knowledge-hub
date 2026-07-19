import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import { hashPassword } from '@project-knowledge-hub/auth';
import { loadEnv } from '@project-knowledge-hub/config';
import {
  createDatabase,
  organizations,
  users,
  workspaces,
} from '@project-knowledge-hub/database';
import { DEFAULT_MCP_SCOPES } from '@project-knowledge-hub/mcp';
import { buildApp } from '../app.js';
import type { FastifyInstance } from 'fastify';

const hasIntegrationEnv =
  Boolean(process.env.DATABASE_URL) && Boolean(process.env.REDIS_URL);

function testEnv() {
  return loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    APP_ENV: 'test',
    LOG_LEVEL: 'silent',
    SESSION_SECRET:
      process.env.SESSION_SECRET ?? 'test-session-secret-at-least-32-chars',
    WEB_URL: process.env.WEB_URL ?? 'http://localhost:3100',
  });
}

async function mcpCall(
  app: FastifyInstance,
  token: string,
  id: number,
  method: string,
  params: Record<string, unknown>,
) {
  return app.inject({
    method: 'POST',
    url: '/mcp',
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
    },
    payload: {
      jsonrpc: '2.0',
      id,
      method,
      params,
    },
  });
}

describe.skipIf(!hasIntegrationEnv)('MCP (read + draft write)', () => {
  let app: FastifyInstance | undefined;
  let redis: Redis | undefined;
  let closeDatabase: (() => Promise<void>) | undefined;
  let adminCookie = '';
  let organizationId = '';
  let workspaceId = '';
  let otherWorkspaceId = '';
  let adminUserId = '';
  let readToken = '';
  let writeToken = '';
  const password = 'test-password-123';

  beforeAll(async () => {
    const env = testEnv();
    const database = createDatabase(env.DATABASE_URL);
    closeDatabase = () => database.close();
    redis = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      enableOfflineQueue: false,
      retryStrategy: () => null,
    });
    await redis.connect();

    const suffix = randomUUID();
    const [org] = await database.db
      .insert(organizations)
      .values({ name: `Org ${suffix}`, slug: `org-${suffix}` })
      .returning();
    if (!org) {
      throw new Error('org missing');
    }
    organizationId = org.id;

    const [admin] = await database.db
      .insert(users)
      .values({
        email: `admin-m6-${suffix}@example.com`,
        displayName: 'Admin',
        passwordHash: await hashPassword(password),
        isSystemAdmin: true,
        status: 'active',
      })
      .returning();
    if (!admin) {
      throw new Error('admin missing');
    }
    adminUserId = admin.id;

    const [workspace] = await database.db
      .insert(workspaces)
      .values({
        organizationId: org.id,
        name: `WS ${suffix}`,
        slug: `ws-${suffix}`,
      })
      .returning();
    if (!workspace) {
      throw new Error('workspace missing');
    }
    workspaceId = workspace.id;

    const [otherWorkspace] = await database.db
      .insert(workspaces)
      .values({
        organizationId: org.id,
        name: `WS other ${suffix}`,
        slug: `ws-other-${suffix}`,
      })
      .returning();
    if (!otherWorkspace) {
      throw new Error('other workspace missing');
    }
    otherWorkspaceId = otherWorkspace.id;

    app = await buildApp({ env, database, redis });
    await app.ready();

    const adminLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: admin.email, password },
    });
    adminCookie = `${env.SESSION_COOKIE_NAME}=${adminLogin.cookies.find((c) => c.name === env.SESSION_COOKIE_NAME)?.value}`;

    const readClient = await app.inject({
      method: 'POST',
      url: '/api/v1/api-clients',
      headers: { cookie: adminCookie, origin: 'http://localhost:3100' },
      payload: {
        organizationId,
        name: 'MCP read client',
        allowedWorkspaceIds: [workspaceId],
      },
    });
    expect(readClient.statusCode).toBe(200);
    readToken = (readClient.json() as { token: string }).token;

    const writeClient = await app.inject({
      method: 'POST',
      url: '/api/v1/api-clients',
      headers: { cookie: adminCookie, origin: 'http://localhost:3100' },
      payload: {
        organizationId,
        name: 'MCP write client',
        scopes: [...DEFAULT_MCP_SCOPES, 'knowledge:write'],
        allowedWorkspaceIds: [workspaceId],
        actingUserId: adminUserId,
      },
    });
    expect(writeClient.statusCode).toBe(200);
    writeToken = (writeClient.json() as { token: string }).token;

    await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { cookie: adminCookie, origin: 'http://localhost:3100' },
      payload: { workspaceId, name: 'MCP Project', status: 'active' },
    });

    await app.inject({
      method: 'POST',
      url: '/api/v1/knowledge-records',
      headers: { cookie: adminCookie, origin: 'http://localhost:3100' },
      payload: {
        workspaceId,
        title: 'MCP Bridge Config',
        recordType: 'configuration',
        lifecycleStatus: 'verified',
        contentMarkdown: '# Bridge\n\nCurrent Tailscale Headscale bridge settings.\n',
      },
    });
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    if (redis) {
      try {
        await redis.quit();
      } catch {
        redis.disconnect();
      }
    }
    if (closeDatabase) {
      await closeDatabase();
    }
  });

  it('rejects MCP without bearer token', async () => {
    const response = await app!.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
      },
      payload: {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test', version: '1.0.0' },
        },
      },
    });
    expect(response.statusCode).toBe(401);
  });

  it('lists tools and searches knowledge via MCP', async () => {
    const init = await mcpCall(app!, readToken, 1, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test', version: '1.0.0' },
    });
    expect(init.statusCode).toBe(200);
    const initBody = init.json() as {
      result?: { serverInfo?: { name?: string } };
    };
    expect(initBody.result?.serverInfo?.name).toBe('project-knowledge-hub');

    const tools = await mcpCall(app!, readToken, 2, 'tools/list', {});
    expect(tools.statusCode).toBe(200);
    const toolsBody = tools.json() as {
      result?: { tools?: Array<{ name: string }> };
    };
    const names = (toolsBody.result?.tools ?? []).map((tool) => tool.name);
    expect(names).toContain('search_knowledge');
    expect(names).toContain('list_projects');
    expect(names).toContain('list_record_metadata');
    expect(names).toContain('create_knowledge_record');
    expect(names).toContain('update_knowledge_record');

    const search = await mcpCall(app!, readToken, 3, 'tools/call', {
      name: 'search_knowledge',
      arguments: {
        workspaceId,
        query: 'Bridge',
        limit: 5,
      },
    });
    expect(search.statusCode).toBe(200);
    const searchBody = search.json() as {
      result?: { content?: Array<{ text?: string }>; isError?: boolean };
    };
    expect(searchBody.result?.isError).toBeFalsy();
    const text = searchBody.result?.content?.[0]?.text ?? '';
    expect(text.toLowerCase()).toContain('bridge');
  });

  it('denies create without knowledge:write scope', async () => {
    const response = await mcpCall(app!, readToken, 10, 'tools/call', {
      name: 'create_knowledge_record',
      arguments: {
        workspaceId,
        title: 'Should fail',
        recordType: 'runbook',
        contentMarkdown: '# Nope\n',
      },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      result?: { isError?: boolean; content?: Array<{ text?: string }> };
    };
    expect(body.result?.isError).toBe(true);
    expect(body.result?.content?.[0]?.text ?? '').toContain('knowledge:write');
  });

  it('rejects write client create without actingUserId / allowlist', async () => {
    const missingActing = await app!.inject({
      method: 'POST',
      url: '/api/v1/api-clients',
      headers: { cookie: adminCookie, origin: 'http://localhost:3100' },
      payload: {
        organizationId,
        name: 'bad write client',
        scopes: [...DEFAULT_MCP_SCOPES, 'knowledge:write'],
        allowedWorkspaceIds: [workspaceId],
      },
    });
    expect(missingActing.statusCode).toBe(400);

    const missingAllowlist = await app!.inject({
      method: 'POST',
      url: '/api/v1/api-clients',
      headers: { cookie: adminCookie, origin: 'http://localhost:3100' },
      payload: {
        organizationId,
        name: 'bad write client 2',
        scopes: [...DEFAULT_MCP_SCOPES, 'knowledge:write'],
        actingUserId: adminUserId,
        allowedWorkspaceIds: [],
      },
    });
    expect(missingAllowlist.statusCode).toBe(400);
  });

  it('creates and updates draft knowledge via write MCP tools', async () => {
    const create = await mcpCall(app!, writeToken, 20, 'tools/call', {
      name: 'create_knowledge_record',
      arguments: {
        workspaceId,
        title: 'Agent Draft Runbook',
        recordType: 'runbook',
        contentMarkdown: '# Agent draft\n\nSteps here.\n',
        summary: 'Created by MCP test',
        generatedByModel: 'test-model',
      },
    });
    expect(create.statusCode).toBe(200);
    const createBody = create.json() as {
      result?: { isError?: boolean; content?: Array<{ text?: string }> };
    };
    expect(createBody.result?.isError).toBeFalsy();
    const created = JSON.parse(createBody.result?.content?.[0]?.text ?? '{}') as {
      knowledgeRecord?: {
        id: string;
        lifecycleStatus: string;
        sourceOfTruthMode: string;
      };
    };
    expect(created.knowledgeRecord?.lifecycleStatus).toBe('draft');
    expect(created.knowledgeRecord?.sourceOfTruthMode).toBe('ai_generated_draft');
    const recordId = created.knowledgeRecord?.id;
    expect(recordId).toBeTruthy();

    const update = await mcpCall(app!, writeToken, 21, 'tools/call', {
      name: 'update_knowledge_record',
      arguments: {
        recordId,
        changeMessage: 'Clarify steps',
        contentMarkdown: '# Agent draft\n\nUpdated steps.\n',
      },
    });
    expect(update.statusCode).toBe(200);
    const updateBody = update.json() as {
      result?: { isError?: boolean; content?: Array<{ text?: string }> };
    };
    expect(updateBody.result?.isError).toBeFalsy();
    const updated = JSON.parse(updateBody.result?.content?.[0]?.text ?? '{}') as {
      knowledgeRecord?: { lifecycleStatus: string; versioned?: boolean };
    };
    expect(updated.knowledgeRecord?.lifecycleStatus).toBe('draft');
    expect(updated.knowledgeRecord?.versioned).toBe(true);
  });

  it('denies write to a workspace outside the allowlist', async () => {
    const create = await mcpCall(app!, writeToken, 30, 'tools/call', {
      name: 'create_knowledge_record',
      arguments: {
        workspaceId: otherWorkspaceId,
        title: 'Outside allowlist',
        recordType: 'overview',
        contentMarkdown: '# Outside\n',
      },
    });
    expect(create.statusCode).toBe(200);
    const body = create.json() as {
      result?: { isError?: boolean; content?: Array<{ text?: string }> };
    };
    expect(body.result?.isError).toBe(true);
    expect(body.result?.content?.[0]?.text ?? '').toMatch(/not allowed|Workspace/i);
  });
});
