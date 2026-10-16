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

type StatusRow = { id: string; status: string };
type DatedRow = StatusRow & {
  startDate: string | null;
  endDate?: string | null;
  targetDate?: string | null;
};
type ScheduleRow = {
  id: string;
  startDate: string | null;
  finishDate: string | null;
};

describe.skipIf(!hasIntegrationEnv)('parent status from children', () => {
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
        email: `admin-parent-${suffix}@example.com`,
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
    if (!org || !admin || !workspace) throw new Error('fixture missing');
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
    adminCookie = `${env.SESSION_COOKIE_NAME}=${
      login.cookies.find((cookie) => cookie.name === env.SESSION_COOKIE_NAME)?.value
    }`;
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

  function headers(json = false): Record<string, string> {
    return json
      ? { cookie: adminCookie, origin, 'content-type': 'application/json' }
      : { cookie: adminCookie, origin };
  }

  async function createProject(): Promise<string> {
    const response = await app!.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: headers(true),
      payload: { workspaceId, name: `Parents ${randomUUID()}` },
    });
    expect(response.statusCode).toBe(200);
    return (response.json() as { project: { id: string } }).project.id;
  }

  async function createEpic(projectId: string, title: string): Promise<string> {
    const response = await app!.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/epics`,
      headers: headers(true),
      payload: { title },
    });
    expect(response.statusCode).toBe(200);
    return (response.json() as { epic: { id: string } }).epic.id;
  }

  async function createStory(
    projectId: string,
    epicId: string,
    title: string,
  ): Promise<string> {
    const response = await app!.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/user-stories`,
      headers: headers(true),
      payload: { epicId, title },
    });
    expect(response.statusCode).toBe(200);
    return (response.json() as { userStory: { id: string } }).userStory.id;
  }

  async function createTask(
    projectId: string,
    payload: Record<string, unknown>,
  ): Promise<string> {
    const response = await app!.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/tasks`,
      headers: headers(true),
      payload,
    });
    expect(response.statusCode).toBe(200);
    return (response.json() as { task: { id: string } }).task.id;
  }

  async function patchTask(taskId: string, payload: Record<string, unknown>): Promise<void> {
    const response = await app!.inject({
      method: 'PATCH',
      url: `/api/v1/project-tasks/${taskId}`,
      headers: headers(true),
      payload,
    });
    expect(response.statusCode).toBe(200);
  }

  async function statuses(projectId: string): Promise<{
    epics: DatedRow[];
    stories: DatedRow[];
    milestones: DatedRow[];
  }> {
    const [epics, stories, milestones] = await Promise.all([
      app!.inject({
        method: 'GET',
        url: `/api/v1/projects/${projectId}/epics`,
        headers: { cookie: adminCookie },
      }),
      app!.inject({
        method: 'GET',
        url: `/api/v1/projects/${projectId}/user-stories`,
        headers: { cookie: adminCookie },
      }),
      app!.inject({
        method: 'GET',
        url: `/api/v1/projects/${projectId}/milestones`,
        headers: { cookie: adminCookie },
      }),
    ]);
    expect(epics.statusCode).toBe(200);
    expect(stories.statusCode).toBe(200);
    expect(milestones.statusCode).toBe(200);
    return {
      epics: (epics.json() as { epics: DatedRow[] }).epics,
      stories: (stories.json() as { userStories: DatedRow[] }).userStories,
      milestones: (milestones.json() as { milestones: DatedRow[] }).milestones,
    };
  }

  function statusOf(rows: StatusRow[], id: string): string {
    const row = rows.find((item) => item.id === id);
    expect(row).toBeTruthy();
    return row!.status;
  }

  async function windows(projectId: string): Promise<{
    epics: DatedRow[];
    stories: DatedRow[];
    milestones: DatedRow[];
  }> {
    return statuses(projectId);
  }

  function windowOf(rows: DatedRow[], id: string): {
    startDate: string | null;
    endDate: string | null;
  } {
    const row = rows.find((item) => item.id === id);
    expect(row).toBeTruthy();
    return {
      startDate: row!.startDate,
      endDate: row!.endDate ?? row!.targetDate ?? null,
    };
  }

  it('derives story and epic status from child status and percent', async () => {
    const projectId = await createProject();
    const epicId = await createEpic(projectId, 'Epic');
    const storyId = await createStory(projectId, epicId, 'Story');

    const kept = await app!.inject({
      method: 'PATCH',
      url: `/api/v1/project-user-stories/${storyId}`,
      headers: headers(true),
      payload: { status: 'active' },
    });
    expect(kept.statusCode).toBe(200);
    expect((kept.json() as { userStory: { status: string } }).userStory.status).toBe('active');

    const open = await statuses(projectId);
    expect(statusOf(open.epics, epicId)).toBe('planned');

    const taskId = await createTask(projectId, {
      title: 'Open',
      userStoryId: storyId,
      status: 'todo',
      completionPercent: 0,
    });
    const idle = await statuses(projectId);
    expect(statusOf(idle.stories, storyId)).toBe('planned');
    expect(statusOf(idle.epics, epicId)).toBe('planned');

    await patchTask(taskId, { status: 'in_progress', completionPercent: 0 });
    const started = await statuses(projectId);
    expect(statusOf(started.stories, storyId)).toBe('in_progress');
    expect(statusOf(started.epics, epicId)).toBe('in_progress');

    await patchTask(taskId, { completionPercent: 50 });
    const halfway = await statuses(projectId);
    expect(statusOf(halfway.stories, storyId)).toBe('in_progress');

    await patchTask(taskId, { status: 'blocked', completionPercent: 25 });
    const blocked = await statuses(projectId);
    expect(statusOf(blocked.stories, storyId)).toBe('blocked');
    expect(statusOf(blocked.epics, epicId)).toBe('blocked');

    const doneId = await createTask(projectId, {
      title: 'Finished',
      userStoryId: storyId,
      status: 'done',
    });
    const stillBlocked = await statuses(projectId);
    expect(statusOf(stillBlocked.stories, storyId)).toBe('blocked');

    await patchTask(taskId, { status: 'done', completionPercent: 100 });
    await createTask(projectId, {
      title: 'Dropped',
      userStoryId: storyId,
      status: 'cancelled',
    });
    const done = await statuses(projectId);
    expect(statusOf(done.stories, storyId)).toBe('done');
    expect(statusOf(done.epics, epicId)).toBe('done');
    expect(doneId).toBeTruthy();
  });

  it('recomputes both parents when a task moves and when a story moves', async () => {
    const projectId = await createProject();
    const epicA = await createEpic(projectId, 'Epic A');
    const epicB = await createEpic(projectId, 'Epic B');
    const storyA = await createStory(projectId, epicA, 'Story A');
    const storyB = await createStory(projectId, epicA, 'Story B');
    const moving = await createTask(projectId, {
      title: 'Moving',
      userStoryId: storyA,
      status: 'in_progress',
      completionPercent: 50,
    });
    const staying = await createTask(projectId, {
      title: 'Staying',
      userStoryId: storyB,
      status: 'todo',
      completionPercent: 0,
    });

    const before = await statuses(projectId);
    expect(statusOf(before.stories, storyA)).toBe('in_progress');
    expect(statusOf(before.stories, storyB)).toBe('planned');
    expect(statusOf(before.epics, epicA)).toBe('in_progress');
    expect(statusOf(before.epics, epicB)).toBe('planned');

    const movedStory = await app!.inject({
      method: 'PATCH',
      url: `/api/v1/project-user-stories/${storyA}`,
      headers: headers(true),
      payload: { epicId: epicB },
    });
    expect(movedStory.statusCode).toBe(200);
    const afterMove = await statuses(projectId);
    expect(statusOf(afterMove.stories, storyA)).toBe('in_progress');
    expect(statusOf(afterMove.epics, epicA)).toBe('planned');
    expect(statusOf(afterMove.epics, epicB)).toBe('in_progress');

    await patchTask(moving, { userStoryId: storyB });
    const afterTask = await statuses(projectId);
    expect(statusOf(afterTask.stories, storyA)).toBe('in_progress');
    expect(statusOf(afterTask.stories, storyB)).toBe('in_progress');
    expect(statusOf(afterTask.epics, epicA)).toBe('in_progress');
    expect(statusOf(afterTask.epics, epicB)).toBe('in_progress');
    expect(staying).toBeTruthy();
  });

  it('derives milestone status from linked items and keeps a manual status with none', async () => {
    const projectId = await createProject();
    const epicId = await createEpic(projectId, 'Epic');
    const storyId = await createStory(projectId, epicId, 'Story');
    const taskId = await createTask(projectId, {
      title: 'Linked',
      userStoryId: storyId,
      status: 'in_progress',
      completionPercent: 50,
    });
    const created = await app!.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/milestones`,
      headers: headers(true),
      payload: { title: 'Gate', status: 'active' },
    });
    expect(created.statusCode).toBe(200);
    const milestoneId = (created.json() as { milestone: { id: string; status: string } }).milestone
      .id;
    expect((created.json() as { milestone: { status: string } }).milestone.status).toBe('active');

    const linked = await app!.inject({
      method: 'PUT',
      url: `/api/v1/project-milestones/${milestoneId}/item-links`,
      headers: headers(true),
      payload: { items: [{ entityType: 'task', entityId: taskId }] },
    });
    expect(linked.statusCode).toBe(200);
    expect((linked.json() as { milestone: { status: string } }).milestone.status).toBe(
      'in_progress',
    );

    await patchTask(taskId, { status: 'done', completionPercent: 100 });
    const done = await statuses(projectId);
    expect(statusOf(done.milestones, milestoneId)).toBe('done');

    const blockedId = await createTask(projectId, {
      title: 'Stuck',
      status: 'blocked',
      completionPercent: 0,
    });
    const relinked = await app!.inject({
      method: 'PUT',
      url: `/api/v1/project-milestones/${milestoneId}/item-links`,
      headers: headers(true),
      payload: {
        items: [
          { entityType: 'task', entityId: taskId },
          { entityType: 'task', entityId: blockedId },
        ],
      },
    });
    expect(relinked.statusCode).toBe(200);
    expect((relinked.json() as { milestone: { status: string } }).milestone.status).toBe(
      'blocked',
    );

    const cleared = await app!.inject({
      method: 'PUT',
      url: `/api/v1/project-milestones/${milestoneId}/item-links`,
      headers: headers(true),
      payload: { items: [] },
    });
    expect(cleared.statusCode).toBe(200);
    expect((cleared.json() as { milestone: { status: string } }).milestone.status).toBe(
      'blocked',
    );
  });

  it('derives parent dates and schedules successors from them', async () => {
    const projectId = await createProject();
    const epicA = await createEpic(projectId, 'Epic A');
    const epicB = await createEpic(projectId, 'Epic B');
    const storyId = await createStory(projectId, epicA, 'Story');
    const kept = await app!.inject({
      method: 'PATCH',
      url: `/api/v1/project-user-stories/${storyId}`,
      headers: headers(true),
      payload: { startDate: '2026-01-01', endDate: '2026-01-31' },
    });
    expect(kept.statusCode).toBe(200);
    expect((kept.json() as { userStory: DatedRow }).userStory).toMatchObject({
      startDate: '2026-01-01',
      endDate: '2026-01-31',
    });

    await createTask(projectId, {
      title: 'Undated',
      userStoryId: storyId,
      status: 'todo',
    });
    const stillManual = await windows(projectId);
    expect(windowOf(stillManual.stories, storyId)).toEqual({
      startDate: '2026-01-01',
      endDate: '2026-01-31',
    });

    const taskId = await createTask(projectId, {
      title: 'Dated',
      userStoryId: storyId,
      status: 'in_progress',
      startDate: '2026-03-02',
      dueDate: '2026-03-20',
    });
    await createTask(projectId, {
      title: 'Dropped',
      userStoryId: storyId,
      status: 'cancelled',
      startDate: '2026-01-01',
      dueDate: '2026-06-01',
    });
    const rolled = await windows(projectId);
    expect(windowOf(rolled.stories, storyId)).toEqual({
      startDate: '2026-03-02',
      endDate: '2026-03-20',
    });
    expect(windowOf(rolled.epics, epicA)).toEqual({
      startDate: '2026-03-02',
      endDate: '2026-03-20',
    });

    const createdMilestone = await app!.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/milestones`,
      headers: headers(true),
      payload: {
        title: 'Gate',
        status: 'active',
        startDate: '2026-08-01',
        targetDate: '2026-08-31',
      },
    });
    expect(createdMilestone.statusCode).toBe(200);
    const milestoneId = (createdMilestone.json() as { milestone: { id: string } }).milestone.id;
    const linked = await app!.inject({
      method: 'PUT',
      url: `/api/v1/project-milestones/${milestoneId}/item-links`,
      headers: headers(true),
      payload: { items: [{ entityType: 'task', entityId: taskId }] },
    });
    expect(linked.statusCode).toBe(200);
    expect((linked.json() as { milestone: DatedRow }).milestone).toMatchObject({
      startDate: '2026-08-01',
      targetDate: '2026-08-31',
    });
    const cleared = await app!.inject({
      method: 'PUT',
      url: `/api/v1/project-milestones/${milestoneId}/item-links`,
      headers: headers(true),
      payload: { items: [] },
    });
    expect(cleared.statusCode).toBe(200);
    expect((cleared.json() as { milestone: DatedRow }).milestone).toMatchObject({
      startDate: '2026-08-01',
      targetDate: '2026-08-31',
    });

    await createTask(projectId, {
      title: 'Wider',
      userStoryId: storyId,
      status: 'todo',
      startDate: '2026-02-15',
      dueDate: '2026-04-01',
    });
    const wider = await windows(projectId);
    expect(windowOf(wider.stories, storyId)).toEqual({
      startDate: '2026-02-15',
      endDate: '2026-04-01',
    });
    expect(windowOf(wider.epics, epicA)).toEqual({
      startDate: '2026-02-15',
      endDate: '2026-04-01',
    });

    const moved = await app!.inject({
      method: 'PATCH',
      url: `/api/v1/project-user-stories/${storyId}`,
      headers: headers(true),
      payload: { epicId: epicB },
    });
    expect(moved.statusCode).toBe(200);
    const afterMove = await windows(projectId);
    expect(windowOf(afterMove.stories, storyId)).toEqual({
      startDate: '2026-02-15',
      endDate: '2026-04-01',
    });
    expect(windowOf(afterMove.epics, epicA)).toEqual({
      startDate: '2026-02-15',
      endDate: '2026-04-01',
    });
    expect(windowOf(afterMove.epics, epicB)).toEqual({
      startDate: '2026-02-15',
      endDate: '2026-04-01',
    });

    const successorId = await createTask(projectId, {
      title: 'After the story',
      durationDays: 2,
    });
    const linkedStory = await app!.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/delivery-dependencies`,
      headers: headers(true),
      payload: {
        predecessorId: storyId,
        predecessorType: 'user_story',
        successorId,
        successorType: 'task',
        linkType: 'FS',
        lagDays: 0,
      },
    });
    expect(linkedStory.statusCode).toBe(200);
    const storyWrite = (
      linkedStory.json() as { schedule: ScheduleRow[] }
    ).schedule.find((row) => row.id === successorId);
    expect(storyWrite).toMatchObject({
      startDate: '2026-04-01',
      finishDate: '2026-04-03',
    });

    const lateId = await createTask(projectId, {
      title: 'Later finish',
      startDate: '2026-05-01',
      durationDays: 3,
    });
    const both = await app!.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/delivery-dependencies`,
      headers: headers(true),
      payload: {
        predecessorId: lateId,
        predecessorType: 'task',
        successorId,
        successorType: 'task',
        linkType: 'FS',
        lagDays: 0,
      },
    });
    expect(both.statusCode).toBe(200);
    const lateWrite = (both.json() as { schedule: ScheduleRow[] }).schedule.find(
      (row) => row.id === successorId,
    );
    expect(lateWrite).toMatchObject({
      startDate: '2026-05-06',
      finishDate: '2026-05-08',
    });
  });
});
