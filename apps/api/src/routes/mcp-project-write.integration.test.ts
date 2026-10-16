import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { hashPassword } from '@project-knowledge-hub/auth';
import { loadEnv } from '@project-knowledge-hub/config';
import {
  auditEvents,
  createDatabase,
  memberships,
  organizations,
  users,
  workspaces,
  type Database,
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
    WEB_URL: 'http://localhost:3100',
  });
}

function prefixFrom(seed: string): string {
  const letters = seed.replace(/[^a-f]/gi, '').toUpperCase();
  return `${letters[0] ?? 'Q'}${letters[1] ?? 'W'}1`;
}

type ToolBody = {
  isError: boolean;
  text: string;
  data: Record<string, unknown>;
};

function toolPayload(response: { json: () => unknown }): ToolBody {
  const body = response.json() as {
    result?: { isError?: boolean; content?: Array<{ text?: string }> };
  };
  const text = body.result?.content?.[0]?.text ?? '';
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(text) as Record<string, unknown>;
  } catch {
    data = {};
  }
  return { isError: Boolean(body.result?.isError), text, data };
}

describe.skipIf(!hasIntegrationEnv)('MCP create_project and update_project (PRO-T-25)', () => {
  let app: FastifyInstance | undefined;
  let redis: Redis | undefined;
  let database: Database | undefined;
  let closeDatabase: (() => Promise<void>) | undefined;
  let adminCookie = '';
  let organizationId = '';
  let workspaceId = '';
  let workspaceName = '';
  let otherWorkspaceId = '';
  let otherWorkspaceName = '';
  let adminUserId = '';
  let readerUserId = '';
  let writerToken = '';
  let readerToken = '';
  let readOnlyToken = '';
  let callId = 1;
  const origin = 'http://localhost:3100';
  const keyPrefix = prefixFrom(randomUUID());

  beforeAll(async () => {
    const env = testEnv();
    database = createDatabase(env.DATABASE_URL);
    closeDatabase = () => database!.close();
    redis = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      enableOfflineQueue: false,
      retryStrategy: () => null,
    });
    await redis.connect();

    const suffix = randomUUID().slice(0, 8);
    const [org] = await database.db
      .insert(organizations)
      .values({ name: `Proj ${suffix}`, slug: `proj-${suffix}` })
      .returning();
    const [admin] = await database.db
      .insert(users)
      .values({
        email: `proj-admin-${suffix}@example.com`,
        displayName: 'Project Admin',
        passwordHash: await hashPassword('test-password-123'),
        isSystemAdmin: true,
        status: 'active',
      })
      .returning();
    const [reader] = await database.db
      .insert(users)
      .values({
        email: `proj-reader-${suffix}@example.com`,
        displayName: 'Project Reader',
        passwordHash: await hashPassword('test-password-123'),
        isSystemAdmin: false,
        status: 'active',
      })
      .returning();
    const [workspace] = await database.db
      .insert(workspaces)
      .values({
        organizationId: org!.id,
        name: `Lab ${suffix}`,
        slug: `lab-${suffix}`,
      })
      .returning();
    const [other] = await database.db
      .insert(workspaces)
      .values({
        organizationId: org!.id,
        name: `Other ${suffix}`,
        slug: `other-${suffix}`,
      })
      .returning();
    organizationId = org!.id;
    adminUserId = admin!.id;
    readerUserId = reader!.id;
    workspaceId = workspace!.id;
    workspaceName = workspace!.name;
    otherWorkspaceId = other!.id;
    otherWorkspaceName = other!.name;
    await database.db.insert(memberships).values([
      { userId: adminUserId, workspaceId, role: 'workspace_admin' },
      { userId: readerUserId, workspaceId, role: 'reader' },
    ]);

    app = await buildApp({ env, database, redis });
    await app.ready();

    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: admin!.email, password: 'test-password-123' },
    });
    adminCookie = `${env.SESSION_COOKIE_NAME}=${
      login.cookies.find((cookie) => cookie.name === env.SESSION_COOKIE_NAME)?.value
    }`;

    async function issue(name: string, scopes: string[], actingUserId: string) {
      const response = await app!.inject({
        method: 'POST',
        url: '/api/v1/api-clients',
        headers: { cookie: adminCookie, origin },
        payload: {
          organizationId,
          name,
          scopes,
          allowedWorkspaceIds: [workspaceId],
          actingUserId,
        },
      });
      expect(response.statusCode).toBe(200);
      return (response.json() as { token: string }).token;
    }

    writerToken = await issue(
      'Project writer',
      [...DEFAULT_MCP_SCOPES, 'projects:write'],
      adminUserId,
    );
    readerToken = await issue(
      'Project reader role',
      [...DEFAULT_MCP_SCOPES, 'projects:write'],
      readerUserId,
    );
    readOnlyToken = await issue('Project read only', [...DEFAULT_MCP_SCOPES], adminUserId);

    const existing = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { cookie: adminCookie, origin },
      payload: {
        workspaceId,
        name: 'Portal Refresh',
        keyPrefix,
        status: 'active',
      },
    });
    expect(existing.statusCode).toBe(200);
  });

  afterAll(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 600);
    });
    if (app) await app.close();
    if (redis) {
      try {
        await redis.quit();
      } catch {
        redis.disconnect();
      }
    }
    if (closeDatabase) await closeDatabase();
  });

  async function mcp(
    token: string,
    name: string,
    args: Record<string, unknown>,
  ): Promise<ToolBody> {
    const response = await app!.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
      },
      payload: {
        jsonrpc: '2.0',
        id: callId,
        method: 'tools/call',
        params: { name, arguments: args },
      },
    });
    callId += 1;
    expect(response.statusCode).toBe(200);
    return toolPayload(response);
  }

  it('lists workspace organization, writesAllowed, and role', async () => {
    const listed = await mcp(writerToken, 'list_workspaces', {});
    expect(listed.isError).toBe(false);
    const workspacesBody = listed.data.workspaces as Array<{
      id: string;
      name: string;
      organization: { id: string; name: string };
      writesAllowed: boolean;
      role: string | null;
    }>;
    const row = workspacesBody.find((item) => item.id === workspaceId);
    expect(row?.name).toBe(workspaceName);
    expect(row?.organization.id).toBe(organizationId);
    expect(row?.writesAllowed).toBe(true);
    expect(row?.role).toBe('system_admin');
  });

  it('rejects a reader and a missing projects:write scope with a clear message', async () => {
    const deniedRole = await mcp(readerToken, 'create_project', {
      workspaceId,
      name: 'Reader should fail',
    });
    expect(deniedRole.isError).toBe(true);
    expect(deniedRole.text).toContain('reader');
    expect(deniedRole.text).toContain('maintainer');
    expect(deniedRole.text).not.toBe('Workspace is not allowed');

    const deniedScope = await mcp(readOnlyToken, 'create_project', {
      workspaceId,
      name: 'Scope should fail',
    });
    expect(deniedScope.isError).toBe(true);
    expect(deniedScope.text).toBe('Missing required scope: projects:write');

    const outside = await mcp(writerToken, 'create_project', {
      workspaceId: otherWorkspaceId,
      name: 'Outside allow-list',
    });
    expect(outside.isError).toBe(true);
    expect(outside.text).toContain(otherWorkspaceName);
    expect(outside.text).toContain('allow-list');
    expect(outside.text).not.toBe('Workspace is not allowed');
  });

  it('suggests a free key prefix and warns on a similar name', async () => {
    const collision = await mcp(writerToken, 'create_project', {
      workspaceId,
      name: 'Key collision proposal',
      keyPrefix,
    });
    expect(collision.isError).toBe(true);
    expect(collision.text).toContain('Suggested available prefix');
    expect(collision.text).toContain(keyPrefix);

    const duplicate = await mcp(writerToken, 'create_project', {
      workspaceId,
      name: 'Portal Refresh',
      description: 'Second copy',
    });
    expect(duplicate.isError).toBe(true);
    expect(duplicate.text).toContain('similar name');
    expect(duplicate.text).toContain('confirmDuplicateName');
  });

  it('creates an idea project through the API and refuses promotion', async () => {
    const created = await app!.inject({
      method: 'POST',
      url: '/api/v1/llm/tools/create_project',
      headers: { authorization: `Bearer ${writerToken}` },
      payload: {
        workspaceId,
        name: 'Portal Refresh',
        description: 'Agent proposal',
        methodology: 'scrum',
        currency: 'EUR',
        confirmDuplicateName: true,
        generatedByModel: 'gpt-test',
      },
    });
    expect(created.statusCode).toBe(200);
    const body = created.json() as {
      project: {
        id: string;
        status: string;
        keyPrefix: string;
        url: string;
        createdVia: string;
        createdByApiClientId: string;
        createdByUserId: string;
        generatedByModel: string;
        warning: string | null;
      };
    };
    expect(body.project.status).toBe('idea');
    expect(body.project.keyPrefix).toMatch(/^([A-Z]{3}|[A-Z]{2}[0-9])$/);
    expect(body.project.url).toContain('/projects/');
    expect(body.project.createdVia).toBe('mcp');
    expect(body.project.createdByUserId).toBe(adminUserId);
    expect(body.project.generatedByModel).toBe('gpt-test');
    expect(body.project.warning).toContain('similar name');

    const listed = await mcp(writerToken, 'list_projects', {
      workspaceId,
      stage: 'idea',
    });
    expect(listed.isError).toBe(false);
    const projects = listed.data.projects as Array<{ id: string; status: string }>;
    expect(projects.some((row) => row.id === body.project.id && row.status === 'idea')).toBe(
      true,
    );

    const promoted = await mcp(writerToken, 'update_project', {
      projectId: body.project.id,
      status: 'active',
    });
    expect(promoted.isError).toBe(true);
    expect(promoted.text).toContain('cannot promote');
    expect(promoted.text).toContain('active');

    const renamed = await mcp(writerToken, 'update_project', {
      projectId: body.project.id,
      description: 'Still an idea',
      methodology: 'hybrid',
    });
    expect(renamed.isError).toBe(false);
    const updated = renamed.data.project as {
      status: string;
      description: string;
      methodology: string;
      createdVia: string;
      url: string;
    };
    expect(updated.status).toBe('idea');
    expect(updated.description).toBe('Still an idea');
    expect(updated.methodology).toBe('hybrid');
    expect(updated.createdVia).toBe('mcp');
    expect(updated.url).toContain('/projects/');

    const fetched = await mcp(writerToken, 'get_project', { projectId: body.project.id });
    expect(fetched.isError).toBe(false);
    const project = fetched.data.project as {
      createdVia: string;
      createdByApiClientId: string;
      generatedByModel: string;
      status: string;
    };
    expect(project.createdVia).toBe('mcp');
    expect(project.createdByApiClientId).toBeTruthy();
    expect(project.generatedByModel).toBe('gpt-test');
    expect(project.status).toBe('idea');

    const audits = await database!.db
      .select({ action: auditEvents.action })
      .from(auditEvents)
      .where(eq(auditEvents.entityId, body.project.id));
    expect(audits.map((row) => row.action)).toEqual(
      expect.arrayContaining(['project.create', 'project.update']),
    );
  });
});
