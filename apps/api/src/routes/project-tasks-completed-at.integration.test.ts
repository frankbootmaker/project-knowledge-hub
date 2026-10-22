import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import { hashPassword } from '@project-knowledge-hub/auth';
import { loadEnv } from '@project-knowledge-hub/config';
import {
  createDatabase,
  memberships,
  organizations,
  projectTaskActivities,
  projectTasks,
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

type TaskPayload = {
  id: string;
  status: string;
  updatedAt: string;
  completedAt: string | null;
};

describe.skipIf(!hasIntegrationEnv)('task completedAt', () => {
  let app: FastifyInstance | undefined;
  let redis: Redis | undefined;
  let closeDatabase: (() => Promise<void>) | undefined;
  let database: ReturnType<typeof createDatabase> | undefined;
  let adminCookie = '';
  let workspaceId = '';
  const password = 'test-password-123';
  const origin = 'http://localhost:3100';

  beforeAll(async () => {
    const env = testEnv();
    database = createDatabase(env.DATABASE_URL);
    closeDatabase = () => database?.close() ?? Promise.resolve();
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
        email: `admin-done-${suffix}@example.com`,
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
      payload: { workspaceId, name: `Done at ${randomUUID()}` },
    });
    expect(response.statusCode).toBe(200);
    return (response.json() as { project: { id: string } }).project.id;
  }

  async function createTask(projectId: string, title: string): Promise<string> {
    const response = await app!.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/tasks`,
      headers: { cookie: adminCookie, origin },
      payload: { title, status: 'todo' },
    });
    expect(response.statusCode).toBe(200);
    return (response.json() as { task: { id: string } }).task.id;
  }

  it('returns the latest status_changed→done time on list and detail', async () => {
    const projectId = await createProject();
    const taskId = await createTask(projectId, 'Ship the readout');
    const older = new Date(Date.now() - 30 * 60 * 60 * 1000);
    const latest = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const staleUpdatedAt = new Date(Date.now() - 10 * 60 * 60 * 1000);

    await database!.db.insert(projectTaskActivities).values([
      {
        taskId,
        type: 'status_changed',
        metadataJson: { from: 'in_progress', to: 'done' },
        createdAt: older,
      },
      {
        taskId,
        type: 'status_changed',
        metadataJson: { from: 'in_progress', to: 'in_progress' },
        createdAt: new Date(latest.getTime() + 60_000),
      },
      {
        taskId,
        type: 'status_changed',
        metadataJson: { from: 'todo', to: 'done' },
        createdAt: latest,
      },
    ]);
    await database!.db
      .update(projectTasks)
      .set({ status: 'done', updatedAt: staleUpdatedAt })
      .where(eq(projectTasks.id, taskId));

    const list = await app!.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/tasks`,
      headers: { cookie: adminCookie },
    });
    expect(list.statusCode).toBe(200);
    const listed = (list.json() as { tasks: TaskPayload[] }).tasks.find(
      (task) => task.id === taskId,
    );
    expect(listed?.completedAt).toBe(latest.toISOString());
    expect(listed?.completedAt).not.toBe(listed?.updatedAt);
    expect(listed?.updatedAt).toBe(staleUpdatedAt.toISOString());

    const detail = await app!.inject({
      method: 'GET',
      url: `/api/v1/project-tasks/${taskId}`,
      headers: { cookie: adminCookie },
    });
    expect(detail.statusCode).toBe(200);
    const task = (detail.json() as { task: TaskPayload }).task;
    expect(task.completedAt).toBe(latest.toISOString());
    expect(task.completedAt).not.toBe(task.updatedAt);
  });

  it('leaves completedAt null when a task is done without a done activity', async () => {
    const projectId = await createProject();
    const taskId = await createTask(projectId, 'Imported as done');
    const updatedAt = new Date(Date.now() - 60 * 60 * 1000);
    await database!.db
      .update(projectTasks)
      .set({ status: 'done', updatedAt })
      .where(eq(projectTasks.id, taskId));

    const detail = await app!.inject({
      method: 'GET',
      url: `/api/v1/project-tasks/${taskId}`,
      headers: { cookie: adminCookie },
    });
    const task = (detail.json() as { task: TaskPayload }).task;
    expect(task.status).toBe('done');
    expect(task.updatedAt).toBe(updatedAt.toISOString());
    expect(task.completedAt).toBeNull();
  });

  it('sets completedAt when a task or bug is created as done (PRO-B-34)', async () => {
    const projectId = await createProject();
    const before = Date.now();
    const created = await app!.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/tasks`,
      headers: { cookie: adminCookie, origin },
      payload: { title: 'Shipped on create', status: 'done', itemType: 'task' },
    });
    expect(created.statusCode).toBe(200);
    const task = (created.json() as { task: TaskPayload & { completionPercent: number } }).task;
    expect(task.status).toBe('done');
    expect(task.completionPercent).toBe(100);
    expect(task.completedAt).toBeTruthy();
    const completedMs = Date.parse(task.completedAt ?? '');
    expect(completedMs).toBeGreaterThanOrEqual(before - 1000);
    expect(completedMs).toBeLessThanOrEqual(Date.now() + 1000);

    const bug = await app!.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/tasks`,
      headers: { cookie: adminCookie, origin },
      payload: {
        title: 'Fixed on create',
        status: 'done',
        itemType: 'bug',
        severity: 'low',
      },
    });
    expect(bug.statusCode).toBe(200);
    const bugBody = (bug.json() as { task: TaskPayload }).task;
    expect(bugBody.status).toBe('done');
    expect(bugBody.completedAt).toBeTruthy();

    const byPercent = await app!.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/tasks`,
      headers: { cookie: adminCookie, origin },
      payload: { title: 'UI create at 100', completionPercent: 100 },
    });
    expect(byPercent.statusCode).toBe(200);
    const percentTask = (byPercent.json() as { task: TaskPayload }).task;
    expect(percentTask.status).toBe('done');
    expect(percentTask.completedAt).toBeTruthy();
  });

  it('sets completedAt on update into done and clears it on reopen (PRO-B-34)', async () => {
    const projectId = await createProject();
    const taskId = await createTask(projectId, 'Finish later');
    const done = await app!.inject({
      method: 'PATCH',
      url: `/api/v1/project-tasks/${taskId}`,
      headers: { cookie: adminCookie, origin },
      payload: { status: 'done' },
    });
    expect(done.statusCode).toBe(200);
    const finished = (done.json() as { task: TaskPayload & { completionPercent: number } }).task;
    expect(finished.status).toBe('done');
    expect(finished.completedAt).toBeTruthy();
    expect(finished.completionPercent).toBe(100);

    const reopened = await app!.inject({
      method: 'PATCH',
      url: `/api/v1/project-tasks/${taskId}`,
      headers: { cookie: adminCookie, origin },
      payload: { status: 'in_progress' },
    });
    expect(reopened.statusCode).toBe(200);
    const open = (reopened.json() as { task: TaskPayload & { completionPercent: number } }).task;
    expect(open.status).toBe('in_progress');
    expect(open.completedAt).toBeNull();
    expect(open.completionPercent).toBe(0);

    const again = await app!.inject({
      method: 'PATCH',
      url: `/api/v1/project-tasks/${taskId}`,
      headers: { cookie: adminCookie, origin },
      payload: { status: 'done' },
    });
    const redone = (again.json() as { task: TaskPayload }).task;
    expect(redone.completedAt).toBeTruthy();

    const kept = await app!.inject({
      method: 'PATCH',
      url: `/api/v1/project-tasks/${taskId}`,
      headers: { cookie: adminCookie, origin },
      payload: { status: 'todo', completionPercent: 50 },
    });
    const partial = (kept.json() as { task: TaskPayload & { completionPercent: number } }).task;
    expect(partial.status).toBe('todo');
    expect(partial.completedAt).toBeNull();
    expect(partial.completionPercent).toBe(50);
  });

  it('clears completedAt after the task leaves done (PRO-B-25)', async () => {
    const projectId = await createProject();
    const taskId = await createTask(projectId, 'Reopened readout');
    const doneAt = new Date(Date.now() - 60 * 60 * 1000);
    await database!.db.insert(projectTaskActivities).values({
      taskId,
      type: 'status_changed',
      metadataJson: { from: 'todo', to: 'done' },
      createdAt: doneAt,
    });
    await database!.db
      .update(projectTasks)
      .set({ status: 'todo', completionPercent: 100, updatedAt: new Date() })
      .where(eq(projectTasks.id, taskId));

    const detail = await app!.inject({
      method: 'GET',
      url: `/api/v1/project-tasks/${taskId}`,
      headers: { cookie: adminCookie },
    });
    const task = (detail.json() as { task: TaskPayload }).task;
    expect(task.status).toBe('todo');
    expect(task.completedAt).toBeNull();
  });
});
