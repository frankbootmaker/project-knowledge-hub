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

describe.skipIf(!hasIntegrationEnv)('Read-only MCP', () => {
  let app: FastifyInstance | undefined;
  let redis: Redis | undefined;
  let closeDatabase: (() => Promise<void>) | undefined;
  let adminCookie = '';
  let organizationId = '';
  let workspaceId = '';
  let apiToken = '';
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

    app = await buildApp({ env, database, redis });
    await app.ready();

    const adminLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: admin.email, password },
    });
    adminCookie = `${env.SESSION_COOKIE_NAME}=${adminLogin.cookies.find((c) => c.name === env.SESSION_COOKIE_NAME)?.value}`;

    const clientResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/api-clients',
      headers: { cookie: adminCookie, origin: 'http://localhost:3100' },
      payload: {
        organizationId,
        name: 'MCP test client',
        allowedWorkspaceIds: [workspaceId],
      },
    });
    expect(clientResponse.statusCode).toBe(200);
    const clientBody = clientResponse.json() as { token: string };
    apiToken = clientBody.token;

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
    const response = await app.inject({
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
    const init = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        authorization: `Bearer ${apiToken}`,
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
    expect(init.statusCode).toBe(200);
    const initBody = init.json() as {
      result?: { serverInfo?: { name?: string } };
      error?: unknown;
    };
    expect(initBody.result?.serverInfo?.name).toBe('project-knowledge-hub');

    const tools = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        authorization: `Bearer ${apiToken}`,
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
      },
      payload: {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {},
      },
    });
    expect(tools.statusCode).toBe(200);
    const toolsBody = tools.json() as {
      result?: { tools?: Array<{ name: string }> };
    };
    const names = (toolsBody.result?.tools ?? []).map((tool) => tool.name);
    expect(names).toContain('search_knowledge');
    expect(names).toContain('list_projects');
    expect(names).not.toContain('create_knowledge_record');

    const search = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        authorization: `Bearer ${apiToken}`,
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
      },
      payload: {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'search_knowledge',
          arguments: {
            workspaceId,
            query: 'Bridge',
            limit: 5,
          },
        },
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
});
