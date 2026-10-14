import { randomUUID } from 'node:crypto';
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
  });
}

async function mcpCall(
  app: FastifyInstance,
  token: string,
  id: number,
  name: string,
  args: Record<string, unknown>,
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
      method: 'tools/call',
      params: { name, arguments: args },
    },
  });
}

function toolPayload<T>(response: { json: () => unknown }): {
  isError: boolean;
  text: string;
  data: T;
} {
  const body = response.json() as {
    result?: { isError?: boolean; content?: Array<{ text?: string }> };
  };
  const text = body.result?.content?.[0]?.text ?? '';
  let data = {} as T;
  try {
    data = JSON.parse(text) as T;
  } catch {
    data = {} as T;
  }
  return { isError: Boolean(body.result?.isError), text, data };
}

type RaciRow = {
  userId: string;
  role: string;
  displayName: string;
};

type TaskPayload = {
  id: string;
  humanKey: string | null;
  itemType: string;
  raci: RaciRow[];
};

function roleKey(task: TaskPayload | undefined): string[] {
  return (task?.raci ?? [])
    .map((entry) => `${entry.role}:${entry.userId}`)
    .sort();
}

describe.skipIf(!hasIntegrationEnv)('MCP get_project_task reflects RACI edits', () => {
  let app: FastifyInstance | undefined;
  let redis: Redis | undefined;
  let closeDatabase: (() => Promise<void>) | undefined;
  let adminCookie = '';
  let readerCookie = '';
  let projectId = '';
  let adminId = '';
  let memberId = '';
  let writeToken = '';
  let readToken = '';
  let callId = 1;
  const password = 'test-password-123';
  const origin = 'http://localhost:3100';

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
    const [admin] = await database.db
      .insert(users)
      .values({
        email: `admin-raci-mcp-${suffix}@example.com`,
        displayName: 'Raci Admin',
        passwordHash: await hashPassword(password),
        isSystemAdmin: true,
        status: 'active',
      })
      .returning();
    const [member] = await database.db
      .insert(users)
      .values({
        email: `member-raci-mcp-${suffix}@example.com`,
        displayName: 'Raci Member',
        passwordHash: await hashPassword(password),
        status: 'active',
      })
      .returning();
    const [reader] = await database.db
      .insert(users)
      .values({
        email: `reader-raci-mcp-${suffix}@example.com`,
        displayName: 'Raci Reader',
        passwordHash: await hashPassword(password),
        status: 'active',
      })
      .returning();
    const [workspace] = await database.db
      .insert(workspaces)
      .values({
        organizationId: org?.id ?? '',
        name: `WS ${suffix}`,
        slug: `ws-${suffix}`,
      })
      .returning();
    adminId = admin?.id ?? '';
    memberId = member?.id ?? '';
    const workspaceId = workspace?.id ?? '';
    await database.db.insert(memberships).values([
      { userId: adminId, workspaceId, role: 'workspace_admin' },
      { userId: memberId, workspaceId, role: 'maintainer' },
      { userId: reader?.id ?? '', workspaceId, role: 'reader' },
    ]);

    app = await buildApp({ env, database, redis });
    await app.ready();

    async function login(email: string): Promise<string> {
      const response = await app!.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email, password },
      });
      const cookie = response.cookies.find(
        (item) => item.name === env.SESSION_COOKIE_NAME,
      );
      return `${env.SESSION_COOKIE_NAME}=${cookie?.value ?? ''}`;
    }

    adminCookie = await login(admin?.email ?? '');
    readerCookie = await login(reader?.email ?? '');

    const project = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { cookie: adminCookie, origin },
      payload: {
        workspaceId,
        name: 'RACI MCP',
        status: 'active',
        keyPrefix: 'RC1',
      },
    });
    expect(project.statusCode).toBe(200);
    projectId = (project.json() as { project: { id: string } }).project.id;

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/api-clients',
      headers: { cookie: adminCookie, origin },
      payload: {
        organizationId: org?.id,
        name: 'MCP raci writer',
        scopes: [...DEFAULT_MCP_SCOPES, 'pm:read', 'pm:write'],
        allowedWorkspaceIds: [workspaceId],
        actingUserId: adminId,
      },
    });
    expect(created.statusCode).toBe(200);
    writeToken = (created.json() as { token: string }).token;

    const readerClient = await app.inject({
      method: 'POST',
      url: '/api/v1/api-clients',
      headers: { cookie: adminCookie, origin },
      payload: {
        organizationId: org?.id,
        name: 'MCP raci reader',
        scopes: [...DEFAULT_MCP_SCOPES, 'pm:read'],
        allowedWorkspaceIds: [workspaceId],
        actingUserId: adminId,
      },
    });
    expect(readerClient.statusCode).toBe(200);
    readToken = (readerClient.json() as { token: string }).token;
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

  async function call<T>(token: string, name: string, args: Record<string, unknown>) {
    callId += 1;
    const response = await mcpCall(app!, token, callId, name, args);
    expect(response.statusCode).toBe(200);
    return toolPayload<T>(response);
  }

  async function readTask(taskId: string): Promise<TaskPayload> {
    const loaded = await call<{ task?: TaskPayload }>(readToken, 'get_project_task', {
      taskId,
    });
    expect(loaded.isError).toBe(false);
    expect(loaded.data.task).toBeTruthy();
    return loaded.data.task as TaskPayload;
  }

  it('returns task and bug RACI from the replace API and from set_project_task_raci', async () => {
    const task = await call<{ task?: TaskPayload }>(writeToken, 'create_project_task', {
      projectId,
      title: 'RACI task',
    });
    expect(task.isError).toBe(false);
    expect(task.data.task?.humanKey).toBe('RC1-T-1');
    const taskId = task.data.task?.id ?? '';

    const bug = await call<{ task?: TaskPayload }>(writeToken, 'create_project_task', {
      projectId,
      title: 'RACI bug',
      itemType: 'bug',
    });
    expect(bug.isError).toBe(false);
    expect(bug.data.task?.humanKey).toBe('RC1-B-1');
    expect(bug.data.task?.itemType).toBe('bug');

    const before = await readTask('RC1-T-1');
    expect(before.raci).toEqual([]);

    const denied = await app!.inject({
      method: 'PUT',
      url: `/api/v1/project-tasks/${taskId}/raci`,
      headers: {
        cookie: readerCookie,
        origin,
        'content-type': 'application/json',
      },
      payload: { entries: [{ userId: adminId, role: 'A' }] },
    });
    expect(denied.statusCode).toBe(403);

    const replaced = await app!.inject({
      method: 'PUT',
      url: `/api/v1/project-tasks/${taskId}/raci`,
      headers: {
        cookie: adminCookie,
        origin,
        'content-type': 'application/json',
      },
      payload: {
        entries: [
          { userId: adminId, role: 'A' },
          { userId: memberId, role: 'R' },
        ],
      },
    });
    expect(replaced.statusCode).toBe(200);

    const afterRest = await readTask(taskId);
    expect(roleKey(afterRest)).toEqual(
      [`A:${adminId}`, `R:${memberId}`].sort(),
    );
    expect(afterRest.raci.find((entry) => entry.userId === memberId)?.displayName).toBe(
      'Raci Member',
    );

    const rewritten = await call<{ task?: TaskPayload }>(
      writeToken,
      'set_project_task_raci',
      {
        taskId: 'RC1-T-1',
        entries: [
          { userId: memberId, role: 'A' },
          { userId: adminId, role: 'C' },
        ],
      },
    );
    expect(rewritten.isError).toBe(false);
    const afterMcp = await readTask('RC1-T-1');
    expect(roleKey(afterMcp)).toEqual([`A:${memberId}`, `C:${adminId}`].sort());

    const twoAccountable = await call(writeToken, 'set_project_task_raci', {
      taskId: 'RC1-T-1',
      entries: [
        { userId: adminId, role: 'A' },
        { userId: memberId, role: 'A' },
      ],
    });
    expect(twoAccountable.isError).toBe(true);
    expect(twoAccountable.text).toMatch(/Accountable/);
    expect(roleKey(await readTask('RC1-T-1'))).toEqual(
      [`A:${memberId}`, `C:${adminId}`].sort(),
    );

    const duplicatePerson = await call(writeToken, 'set_project_task_raci', {
      taskId: 'RC1-T-1',
      entries: [
        { userId: adminId, role: 'A' },
        { userId: adminId, role: 'R' },
      ],
    });
    expect(duplicatePerson.isError).toBe(true);
    expect(duplicatePerson.text).toMatch(/one RACI role/);
    expect(roleKey(await readTask('RC1-T-1'))).toEqual(
      [`A:${memberId}`, `C:${adminId}`].sort(),
    );

    const bugRaci = await call(writeToken, 'set_project_task_raci', {
      taskId: 'RC1-B-1',
      entries: [
        { userId: adminId, role: 'A' },
        { userId: memberId, role: 'I' },
      ],
    });
    expect(bugRaci.isError).toBe(false);
    const bugRead = await readTask('RC1-B-1');
    expect(bugRead.itemType).toBe('bug');
    expect(roleKey(bugRead)).toEqual([`A:${adminId}`, `I:${memberId}`].sort());
  });
});
