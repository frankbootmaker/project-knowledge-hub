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

type TaskBody = {
  id: string;
  itemType: string;
  startDate: string | null;
  dueDate: string | null;
};

describe.skipIf(!hasIntegrationEnv)('task start date', () => {
  let app: FastifyInstance | undefined;
  let redis: Redis | undefined;
  let closeDatabase: (() => Promise<void>) | undefined;
  let adminCookie = '';
  let workspaceId = '';
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
        email: `admin-start-${suffix}@example.com`,
        displayName: 'Admin',
        passwordHash: await hashPassword(password),
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
    if (!org || !admin || !workspace) {
      throw new Error('fixture missing');
    }
    workspaceId = workspace.id;
    await database.db.insert(memberships).values({
      userId: admin.id,
      workspaceId: workspace.id,
      role: 'workspace_admin',
    });

    app = await buildApp({ env, database, redis });
    await app.ready();
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: admin.email, password },
    });
    adminCookie = `${env.SESSION_COOKIE_NAME}=${login.cookies.find((cookie) => cookie.name === env.SESSION_COOKIE_NAME)?.value}`;
  });

  afterAll(async () => {
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

  async function createProject(): Promise<string> {
    const response = await app!.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { cookie: adminCookie, origin },
      payload: { workspaceId, name: `Start ${randomUUID()}` },
    });
    expect(response.statusCode).toBe(200);
    return (response.json() as { project: { id: string } }).project.id;
  }

  it('stores an optional start date on a task and a bug, and lists a due date alone', async () => {
    const projectId = await createProject();

    const task = await app!.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/tasks`,
      headers: { cookie: adminCookie, origin },
      payload: {
        title: 'Windowed task',
        startDate: '2026-10-01',
        dueDate: '2026-10-20',
      },
    });
    expect(task.statusCode).toBe(200);
    const createdTask = (task.json() as { task: TaskBody }).task;
    expect(createdTask.startDate).toBe('2026-10-01');
    expect(createdTask.dueDate).toBe('2026-10-20');

    const bug = await app!.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/tasks`,
      headers: { cookie: adminCookie, origin },
      payload: {
        title: 'Windowed bug',
        itemType: 'bug',
        startDate: '2026-10-05',
      },
    });
    expect(bug.statusCode).toBe(200);
    const createdBug = (bug.json() as { task: TaskBody }).task;
    expect(createdBug.itemType).toBe('bug');
    expect(createdBug.startDate).toBe('2026-10-05');
    expect(createdBug.dueDate).toBeNull();

    const dueOnly = await app!.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/tasks`,
      headers: { cookie: adminCookie, origin },
      payload: { title: 'Due only', dueDate: '2026-11-01' },
    });
    expect(dueOnly.statusCode).toBe(200);
    const dueOnlyTask = (dueOnly.json() as { task: TaskBody }).task;
    expect(dueOnlyTask.startDate).toBeNull();
    expect(dueOnlyTask.dueDate).toBe('2026-11-01');

    const listed = await app!.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/tasks`,
      headers: { cookie: adminCookie },
    });
    expect(listed.statusCode).toBe(200);
    const rows = (listed.json() as { tasks: TaskBody[] }).tasks;
    const listedDue = rows.find((row) => row.id === dueOnlyTask.id);
    expect(listedDue?.dueDate).toBe('2026-11-01');
    expect(listedDue?.startDate).toBeNull();

    const cleared = await app!.inject({
      method: 'PATCH',
      url: `/api/v1/project-tasks/${createdTask.id}`,
      headers: { cookie: adminCookie, origin },
      payload: { startDate: null },
    });
    expect(cleared.statusCode).toBe(200);
    expect((cleared.json() as { task: TaskBody }).task.startDate).toBeNull();
    expect((cleared.json() as { task: TaskBody }).task.dueDate).toBe('2026-10-20');

    const rejected = await app!.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/tasks`,
      headers: { cookie: adminCookie, origin },
      payload: {
        title: 'Backwards',
        startDate: '2026-12-14',
        dueDate: '2026-12-01',
      },
    });
    expect(rejected.statusCode).toBe(400);
    expect((rejected.json() as { error: { code: string } }).error.code).toBe(
      'INVALID_DATE_RANGE',
    );
  });
});
