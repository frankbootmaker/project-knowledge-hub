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

function keyPrefix(): string {
  const letters = randomUUID().replace(/[^a-f]/gi, '').toUpperCase();
  return `${letters[0] ?? 'Q'}${letters[1] ?? 'W'}1`;
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

type MilestoneRow = {
  id: string;
  humanKey: string | null;
  status: string;
  archivedAt: string | null;
  linkedItems?: Array<{ entityId: string }>;
};

describe.skipIf(!hasIntegrationEnv)('MCP archived and cancelled parents (PRO-B-29)', () => {
  let app: FastifyInstance | undefined;
  let redis: Redis | undefined;
  let closeDatabase: (() => Promise<void>) | undefined;
  let writeToken = '';
  let projectId = '';
  let callId = 1;
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
        email: `admin-b29-${suffix}@example.com`,
        displayName: 'B29 Admin',
        passwordHash: await hashPassword('test-password-123'),
        isSystemAdmin: true,
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
    await database.db.insert(memberships).values({
      userId: admin?.id ?? '',
      workspaceId: workspace?.id ?? '',
      role: 'workspace_admin',
    });

    app = await buildApp({ env, database, redis });
    await app.ready();
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: admin?.email, password: 'test-password-123' },
    });
    const adminCookie = `${env.SESSION_COOKIE_NAME}=${
      login.cookies.find((cookie) => cookie.name === env.SESSION_COOKIE_NAME)?.value
    }`;
    const project = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { cookie: adminCookie, origin, 'content-type': 'application/json' },
      payload: {
        workspaceId: workspace?.id,
        name: `Frozen ${suffix}`,
        keyPrefix: keyPrefix(),
      },
    });
    expect(project.statusCode).toBe(200);
    projectId = (project.json() as { project: { id: string } }).project.id;

    const client = await app.inject({
      method: 'POST',
      url: '/api/v1/api-clients',
      headers: { cookie: adminCookie, origin, 'content-type': 'application/json' },
      payload: {
        organizationId: org?.id,
        name: 'MCP b29 writer',
        scopes: [...DEFAULT_MCP_SCOPES, 'pm:read', 'pm:write'],
        allowedWorkspaceIds: [workspace?.id],
        actingUserId: admin?.id,
      },
    });
    expect(client.statusCode).toBe(200);
    writeToken = (client.json() as { token: string }).token;
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

  async function call<T>(name: string, args: Record<string, unknown>) {
    callId += 1;
    const response = await mcpCall(app!, writeToken, callId, name, args);
    expect(response.statusCode).toBe(200);
    return toolPayload<T>(response);
  }

  it('rejects links to an archived milestone and keeps cancelled status', async () => {
    const first = await call<{ task?: { id: string } }>('create_project_task', {
      projectId,
      title: 'Linked',
      status: 'in_progress',
      completionPercent: 50,
    });
    expect(first.isError).toBe(false);
    const taskId = first.data.task?.id ?? '';
    const extra = await call<{ task?: { id: string } }>('create_project_task', {
      projectId,
      title: 'Extra',
      status: 'todo',
    });
    expect(extra.isError).toBe(false);
    const extraId = extra.data.task?.id ?? '';

    const created = await call<{ milestone?: MilestoneRow }>('create_project_milestone', {
      projectId,
      title: 'Gate',
      status: 'cancelled',
    });
    expect(created.isError).toBe(false);
    const milestoneId = created.data.milestone?.id ?? '';
    const humanKey = created.data.milestone?.humanKey ?? '';
    expect(humanKey).toMatch(/-M-1$/);

    const linked = await call<{ milestone?: MilestoneRow }>('set_project_milestone_item_links', {
      milestoneId,
      items: [{ entityType: 'task', entityId: taskId }],
    });
    expect(linked.isError).toBe(false);
    expect(linked.data.milestone?.status).toBe('cancelled');

    const archived = await call<{ milestone?: MilestoneRow }>('update_project_milestone', {
      milestoneId,
      archived: true,
    });
    expect(archived.isError).toBe(false);
    expect(archived.data.milestone?.status).toBe('cancelled');
    expect(archived.data.milestone?.archivedAt).toBeTruthy();

    const rejected = await call('set_project_milestone_item_links', {
      milestoneId,
      items: [
        { entityType: 'task', entityId: taskId },
        { entityType: 'task', entityId: extraId },
      ],
    });
    expect(rejected.isError).toBe(true);
    expect(rejected.text).toBe(
      `Milestone ${humanKey} is archived; unarchive it first`,
    );

    const updated = await call('update_project_task', {
      taskId,
      status: 'done',
      completionPercent: 100,
    });
    expect(updated.isError).toBe(false);

    const frozen = await call<{ milestone?: MilestoneRow }>('get_project_milestone', {
      milestoneId,
    });
    expect(frozen.isError).toBe(false);
    expect(frozen.data.milestone?.status).toBe('cancelled');
    expect(frozen.data.milestone?.archivedAt).toBe(archived.data.milestone?.archivedAt);
    expect(frozen.data.milestone?.linkedItems?.map((item) => item.entityId)).toEqual([taskId]);

    const restored = await call<{ milestone?: MilestoneRow }>('update_project_milestone', {
      milestoneId,
      archived: false,
    });
    expect(restored.isError).toBe(false);
    expect(restored.data.milestone).toMatchObject({ status: 'cancelled', archivedAt: null });

    const moved = await call('update_project_task', {
      taskId,
      status: 'in_progress',
      completionPercent: 50,
    });
    expect(moved.isError).toBe(false);
    const still = await call<{ milestone?: MilestoneRow }>('get_project_milestone', {
      milestoneId,
    });
    expect(still.data.milestone?.status).toBe('cancelled');

    const resumed = await call<{ milestone?: MilestoneRow }>('update_project_milestone', {
      milestoneId,
      status: 'planned',
    });
    expect(resumed.isError).toBe(false);
    expect(resumed.data.milestone?.status).toBe('in_progress');

    const relinked = await call<{ milestone?: MilestoneRow }>(
      'set_project_milestone_item_links',
      {
        milestoneId,
        items: [{ entityType: 'task', entityId: extraId }],
      },
    );
    expect(relinked.isError).toBe(false);
    expect(relinked.data.milestone?.linkedItems?.map((item) => item.entityId)).toEqual([
      extraId,
    ]);

    const epic = await call<{ epic?: { id: string } }>('create_project_epic', {
      projectId,
      title: 'Epic',
    });
    expect(epic.isError).toBe(false);
    const story = await call<{ userStory?: { id: string; humanKey: string | null } }>(
      'create_project_user_story',
      {
        projectId,
        epicId: epic.data.epic?.id,
        title: 'Story',
      },
    );
    expect(story.isError).toBe(false);
    const storyId = story.data.userStory?.id ?? '';
    const archivedStory = await call<{ userStory?: { status: string } }>(
      'update_project_user_story',
      { storyId, archived: true },
    );
    expect(archivedStory.isError).toBe(false);

    const assign = await call('update_project_task', {
      taskId: extraId,
      userStoryId: storyId,
    });
    expect(assign.isError).toBe(true);
    expect(assign.text).toBe(
      `User story ${story.data.userStory?.humanKey} is archived; unarchive it first`,
    );
  });
});
