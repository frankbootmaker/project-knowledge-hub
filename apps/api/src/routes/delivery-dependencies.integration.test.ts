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
  humanKey: string | null;
  itemType: string;
  startDate: string | null;
  dueDate: string | null;
  durationDays: number | null;
};

type ErrorBody = { error: { code: string; message: string } };

type LinkBody = {
  dependency: {
    id: string;
    linkType: string;
    lagDays: number;
    predecessor: { id: string; humanKey: string | null; entityType: string };
    successor: { id: string; humanKey: string | null; entityType: string };
  };
  schedule: Array<{
    entityType: string;
    id: string;
    startDate: string | null;
    finishDate: string | null;
    durationDays: number | null;
  }>;
};

describe.skipIf(!hasIntegrationEnv)('delivery dependencies', () => {
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
        email: `admin-dep-${suffix}@example.com`,
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

  async function createProject(keyPrefix: string): Promise<string> {
    const response = await app!.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { cookie: adminCookie, origin },
      payload: {
        workspaceId,
        name: `Dep ${keyPrefix} ${randomUUID()}`,
        keyPrefix,
      },
    });
    expect(response.statusCode).toBe(200);
    return (response.json() as { project: { id: string } }).project.id;
  }

  async function createTask(
    projectId: string,
    payload: Record<string, unknown>,
  ): Promise<TaskBody> {
    const response = await app!.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/tasks`,
      headers: { cookie: adminCookie, origin },
      payload,
    });
    expect(response.statusCode).toBe(200);
    return (response.json() as { task: TaskBody }).task;
  }

  it('schedules a bug from a task predecessor and rejects bad links', async () => {
    const projectId = await createProject('DPA');
    const otherId = await createProject('DPB');

    const task = await createTask(projectId, {
      title: 'Predecessor',
      startDate: '2026-10-01',
      durationDays: 5,
    });
    expect(task.startDate).toBe('2026-10-01');
    expect(task.dueDate).toBe('2026-10-06');
    expect(task.durationDays).toBe(5);
    expect(task.humanKey).toMatch(/-T-1$/);

    const bug = await createTask(projectId, {
      title: 'Successor bug',
      itemType: 'bug',
      durationDays: 2,
    });
    expect(bug.itemType).toBe('bug');
    expect(bug.humanKey).toMatch(/-B-1$/);
    expect(bug.startDate).toBeNull();
    expect(bug.durationDays).toBe(2);

    const linked = await app!.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/delivery-dependencies`,
      headers: { cookie: adminCookie, origin },
      payload: {
        predecessorId: task.humanKey,
        successorId: bug.humanKey,
        linkType: 'FS',
        lagDays: 0,
      },
    });
    expect(linked.statusCode).toBe(200);
    const link = linked.json() as LinkBody;
    expect(link.dependency.linkType).toBe('FS');
    expect(link.dependency.predecessor.humanKey).toBe(task.humanKey);
    expect(link.dependency.successor.humanKey).toBe(bug.humanKey);
    const bugWrite = link.schedule.find((row) => row.id === bug.id);
    expect(bugWrite).toMatchObject({
      entityType: 'task',
      startDate: '2026-10-06',
      finishDate: '2026-10-08',
      durationDays: 2,
    });

    const listedBug = await app!.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/delivery-dependencies?entityId=${bug.humanKey}`,
      headers: { cookie: adminCookie },
    });
    expect(listedBug.statusCode).toBe(200);
    const bugLinks = listedBug.json() as {
      predecessors: Array<{ id: string }>;
      successors: unknown[];
      scheduleDriven: boolean;
    };
    expect(bugLinks.predecessors).toHaveLength(1);
    expect(bugLinks.successors).toHaveLength(0);
    expect(bugLinks.scheduleDriven).toBe(true);

    const listedTask = await app!.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/delivery-dependencies?entityId=${task.id}&entityType=task`,
      headers: { cookie: adminCookie },
    });
    expect(listedTask.statusCode).toBe(200);
    const taskLinks = listedTask.json() as {
      predecessors: unknown[];
      successors: Array<{ successor: { humanKey: string | null } }>;
    };
    expect(taskLinks.predecessors).toHaveLength(0);
    expect(taskLinks.successors).toHaveLength(1);
    expect(taskLinks.successors[0]?.successor.humanKey).toBe(bug.humanKey);

    const stretched = await app!.inject({
      method: 'PATCH',
      url: `/api/v1/project-tasks/${bug.id}`,
      headers: { cookie: adminCookie, origin },
      payload: { durationDays: 4 },
    });
    expect(stretched.statusCode).toBe(200);
    const stretchedBug = (stretched.json() as { task: TaskBody }).task;
    expect(stretchedBug.startDate).toBe('2026-10-06');
    expect(stretchedBug.dueDate).toBe('2026-10-10');
    expect(stretchedBug.durationDays).toBe(4);

    const selfLink = await app!.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/delivery-dependencies`,
      headers: { cookie: adminCookie, origin },
      payload: {
        predecessorId: task.id,
        predecessorType: 'task',
        successorId: task.id,
        successorType: 'task',
        linkType: 'SS',
      },
    });
    expect(selfLink.statusCode).toBe(400);
    expect((selfLink.json() as ErrorBody).error.code).toBe('DEPENDENCY_SELF_LINK');

    const duplicate = await app!.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/delivery-dependencies`,
      headers: { cookie: adminCookie, origin },
      payload: {
        predecessorId: task.humanKey,
        successorId: bug.humanKey,
        linkType: 'SS',
      },
    });
    expect(duplicate.statusCode).toBe(409);
    expect((duplicate.json() as ErrorBody).error.code).toBe('DEPENDENCY_DUPLICATE');

    const cycle = await app!.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/delivery-dependencies`,
      headers: { cookie: adminCookie, origin },
      payload: {
        predecessorId: bug.humanKey,
        successorId: task.humanKey,
        linkType: 'FS',
      },
    });
    expect(cycle.statusCode).toBe(400);
    expect((cycle.json() as ErrorBody).error.code).toBe('DEPENDENCY_CYCLE');
    expect((cycle.json() as ErrorBody).error.message).toContain('cycle');

    const other = await createTask(otherId, { title: 'Other project' });
    const cross = await app!.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/delivery-dependencies`,
      headers: { cookie: adminCookie, origin },
      payload: {
        predecessorId: other.id,
        predecessorType: 'task',
        successorId: bug.id,
        successorType: 'task',
        linkType: 'FS',
      },
    });
    expect(cross.statusCode).toBe(400);
    expect((cross.json() as ErrorBody).error.code).toBe('DEPENDENCY_CROSS_PROJECT');

    const missingType = await app!.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/delivery-dependencies?entityId=${bug.id}`,
      headers: { cookie: adminCookie },
    });
    expect(missingType.statusCode).toBe(400);
    expect((missingType.json() as ErrorBody).error.code).toBe('DEPENDENCY_TYPE_REQUIRED');
    expect((missingType.json() as ErrorBody).error.message).toContain('Item type');

    const removed = await app!.inject({
      method: 'DELETE',
      url: `/api/v1/projects/${projectId}/delivery-dependencies/${link.dependency.id}`,
      headers: { cookie: adminCookie, origin },
    });
    expect(removed.statusCode).toBe(200);

    const after = await app!.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/delivery-dependencies?entityId=${bug.humanKey}`,
      headers: { cookie: adminCookie },
    });
    expect(after.statusCode).toBe(200);
    expect((after.json() as { predecessors: unknown[] }).predecessors).toHaveLength(0);
  });
});
