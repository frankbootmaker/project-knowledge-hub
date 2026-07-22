import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import { hashPassword } from '@project-knowledge-hub/auth';
import { loadEnv } from '@project-knowledge-hub/config';
import {
  createDatabase,
  memberships,
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
    API_URL: process.env.API_URL ?? 'http://localhost:3101',
  });
}

describe.skipIf(!hasIntegrationEnv)('User MCP setup (/me api-clients)', () => {
  let app: FastifyInstance;
  let redis: Redis;
  let closeDatabase: () => Promise<void>;
  let memberCookie = '';
  let outsiderCookie = '';
  let memberId = '';
  let memberWorkspaceId = '';
  let otherWorkspaceId = '';
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

    const suffix = `me-mcp-${Date.now()}`;
    const [org] = await database.db
      .insert(organizations)
      .values({ name: `Org ${suffix}`, slug: `org-${suffix}` })
      .returning();
    if (!org) throw new Error('org create failed');

    const [member] = await database.db
      .insert(users)
      .values({
        email: `member-${suffix}@example.com`,
        displayName: 'Member',
        passwordHash: await hashPassword(password),
        status: 'active',
      })
      .returning();
    const [outsider] = await database.db
      .insert(users)
      .values({
        email: `outsider-${suffix}@example.com`,
        displayName: 'Outsider',
        passwordHash: await hashPassword(password),
        status: 'active',
      })
      .returning();
    if (!member || !outsider) throw new Error('user create failed');
    memberId = member.id;

    const [ws] = await database.db
      .insert(workspaces)
      .values({
        organizationId: org.id,
        name: `WS ${suffix}`,
        slug: `ws-${suffix}`,
      })
      .returning();
    const [otherWs] = await database.db
      .insert(workspaces)
      .values({
        organizationId: org.id,
        name: `Other ${suffix}`,
        slug: `other-${suffix}`,
      })
      .returning();
    if (!ws || !otherWs) throw new Error('workspace create failed');
    memberWorkspaceId = ws.id;
    otherWorkspaceId = otherWs.id;

    await database.db.insert(memberships).values({
      userId: member.id,
      workspaceId: ws.id,
      role: 'reader',
    });

    app = await buildApp({ env, database, redis });
    await app.ready();

    const memberLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin: env.WEB_URL },
      payload: { email: member.email, password },
    });
    const outsiderLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin: env.WEB_URL },
      payload: { email: outsider.email, password },
    });
    memberCookie = `${env.SESSION_COOKIE_NAME}=${memberLogin.cookies.find((c) => c.name === env.SESSION_COOKIE_NAME)?.value}`;
    outsiderCookie = `${env.SESSION_COOKIE_NAME}=${outsiderLogin.cookies.find((c) => c.name === env.SESSION_COOKIE_NAME)?.value}`;
  });

  afterAll(async () => {
    await app?.close();
    await redis?.quit();
    await closeDatabase?.();
  });

  it('lets a member create and rotate a client for their workspace', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/me/api-clients',
      headers: {
        cookie: memberCookie,
        origin: 'http://localhost:3100',
      },
      payload: {
        name: 'Member Cursor',
        scopes: [...DEFAULT_MCP_SCOPES],
        allowedWorkspaceIds: [memberWorkspaceId],
      },
    });
    expect(create.statusCode).toBe(200);
    const created = create.json() as {
      token: string;
      apiClient: { id: string; actingUserId: string | null };
    };
    expect(created.token.startsWith('kh_')).toBe(true);
    expect(created.apiClient.actingUserId).toBeNull();

    const rotate = await app.inject({
      method: 'POST',
      url: `/api/v1/me/api-clients/${created.apiClient.id}/rotate`,
      headers: {
        cookie: memberCookie,
        origin: 'http://localhost:3100',
      },
      payload: {},
    });
    expect(rotate.statusCode).toBe(200);
    const rotated = rotate.json() as { token: string };
    expect(rotated.token.startsWith('kh_')).toBe(true);
    expect(rotated.token).not.toBe(created.token);
  });

  it('rejects create for a workspace the user does not belong to', async () => {
    const outsiderOnMemberWs = await app.inject({
      method: 'POST',
      url: '/api/v1/me/api-clients',
      headers: {
        cookie: outsiderCookie,
        origin: 'http://localhost:3100',
      },
      payload: {
        name: 'Outsider client',
        scopes: [...DEFAULT_MCP_SCOPES],
        allowedWorkspaceIds: [memberWorkspaceId],
      },
    });
    expect(outsiderOnMemberWs.statusCode).toBe(403);

    const memberOnOtherWs = await app.inject({
      method: 'POST',
      url: '/api/v1/me/api-clients',
      headers: {
        cookie: memberCookie,
        origin: 'http://localhost:3100',
      },
      payload: {
        name: 'Member other ws',
        scopes: [...DEFAULT_MCP_SCOPES],
        allowedWorkspaceIds: [otherWorkspaceId],
      },
    });
    expect(memberOnOtherWs.statusCode).toBe(403);
  });

  it('forces acting user to self for write clients', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/me/api-clients',
      headers: {
        cookie: memberCookie,
        origin: 'http://localhost:3100',
      },
      payload: {
        name: 'Member write',
        scopes: [...DEFAULT_MCP_SCOPES, 'knowledge:write'],
        allowedWorkspaceIds: [memberWorkspaceId],
      },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      apiClient: { actingUserId: string | null };
    };
    expect(body.apiClient.actingUserId).toBe(memberId);
  });

  it('allows member preflight without system admin', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/me/mcp/setup/preflight',
      headers: { cookie: memberCookie },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { endpoints?: { mcpUrl?: string } };
    expect(body.endpoints?.mcpUrl).toBeTruthy();
  });

  it('does not allow outsider to rotate a member client', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/me/api-clients',
      headers: {
        cookie: memberCookie,
        origin: 'http://localhost:3100',
      },
      payload: {
        name: 'Rotate guard',
        scopes: [...DEFAULT_MCP_SCOPES],
        allowedWorkspaceIds: [memberWorkspaceId],
      },
    });
    const clientId = (create.json() as { apiClient: { id: string } }).apiClient.id;

    const rotate = await app.inject({
      method: 'POST',
      url: `/api/v1/me/api-clients/${clientId}/rotate`,
      headers: {
        cookie: outsiderCookie,
        origin: 'http://localhost:3100',
      },
      payload: {},
    });
    expect([403, 404]).toContain(rotate.statusCode);
  });
});
