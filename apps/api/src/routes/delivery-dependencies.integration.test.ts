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
  let database: Database | undefined;
  let closeDatabase: (() => Promise<void>) | undefined;
  let adminCookie = '';
  let workspaceId = '';
  const password = 'test-password-123';
  const origin = 'http://localhost:3100';

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

    const suffix = randomUUID();
    const [org] = await database!.db
      .insert(organizations)
      .values({ name: `Org ${suffix}`, slug: `org-${suffix}` })
      .returning();
    const [admin] = await database!.db
      .insert(users)
      .values({
        email: `admin-dep-${suffix}@example.com`,
        displayName: 'Admin',
        passwordHash: await hashPassword(password),
        isSystemAdmin: true,
        status: 'active',
      })
      .returning();
    const [workspace] = await database!.db
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
    await database!.db.insert(memberships).values({
      userId: admin.id,
      workspaceId: workspace.id,
      role: 'workspace_admin',
    });

    app = await buildApp({ env, database: database!, redis });
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
    expect(task.dueDate).toBe('2026-10-08');
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
      startDate: '2026-10-08',
      finishDate: '2026-10-12',
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

    const listedAll = await app!.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/delivery-dependencies`,
      headers: { cookie: adminCookie },
    });
    expect(listedAll.statusCode).toBe(200);
    const allLinks = listedAll.json() as {
      dependencies: Array<{ id: string; predecessor: { humanKey: string | null } }>;
    };
    expect(allLinks.dependencies.map((row) => row.id)).toContain(link.dependency.id);
    expect(allLinks.dependencies.some((row) => row.predecessor.humanKey === task.humanKey)).toBe(true);

    const stretched = await app!.inject({
      method: 'PATCH',
      url: `/api/v1/project-tasks/${bug.id}`,
      headers: { cookie: adminCookie, origin },
      payload: { durationDays: 4 },
    });
    expect(stretched.statusCode).toBe(200);
    const stretchedBug = (stretched.json() as { task: TaskBody }).task;
    expect(stretchedBug.startDate).toBe('2026-10-08');
    expect(stretchedBug.dueDate).toBe('2026-10-14');
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

  it('schedules a successor from the latest of several predecessors', async () => {
    const projectId = await createProject('DPC');
    const early = await createTask(projectId, {
      title: 'Early finish',
      startDate: '2026-10-01',
      durationDays: 5,
    });
    const late = await createTask(projectId, {
      title: 'Late finish',
      startDate: '2026-10-08',
      durationDays: 2,
    });
    const successor = await createTask(projectId, {
      title: 'Bound successor',
      itemType: 'bug',
      durationDays: 2,
    });

    const linked = await app!.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/delivery-dependencies`,
      headers: { cookie: adminCookie, origin },
      payload: {
        links: [
          {
            predecessorId: early.humanKey,
            successorId: successor.humanKey,
            linkType: 'FS',
          },
          {
            predecessorId: late.humanKey,
            successorId: successor.humanKey,
            linkType: 'FS',
          },
        ],
      },
    });
    expect(linked.statusCode).toBe(200);
    const body = linked.json() as {
      dependencies: Array<{
        id: string;
        predecessor: { id: string };
      }>;
      schedule: Array<{ id: string; startDate: string | null; finishDate: string | null }>;
    };
    expect(body.dependencies).toHaveLength(2);
    const write = body.schedule.find((row) => row.id === successor.id);
    expect(write).toMatchObject({
      startDate: '2026-10-12',
      finishDate: '2026-10-14',
    });

    const lateLink = body.dependencies.find(
      (link) => link.predecessor.id === late.id,
    );
    expect(lateLink).toBeTruthy();
    const lagged = await app!.inject({
      method: 'PATCH',
      url: `/api/v1/projects/${projectId}/delivery-dependencies/${lateLink!.id}`,
      headers: { cookie: adminCookie, origin },
      payload: { lagDays: 1 },
    });
    expect(lagged.statusCode).toBe(200);
    const laggedWrite = (lagged.json() as {
      schedule: Array<{ id: string; startDate: string | null; finishDate: string | null }>;
    }).schedule.find((row) => row.id === successor.id);
    expect(laggedWrite).toMatchObject({
      startDate: '2026-10-13',
      finishDate: '2026-10-15',
    });

    const listed = await app!.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/delivery-dependencies?entityId=${successor.humanKey}`,
      headers: { cookie: adminCookie },
    });
    expect(listed.statusCode).toBe(200);
    expect((listed.json() as { predecessors: unknown[] }).predecessors).toHaveLength(2);
  });

  it('skips holidays for duration, dependencies, and the plan finish', async () => {
    const projectId = await createProject('DPH');
    const saved = await app!.inject({
      method: 'PATCH',
      url: `/api/v1/projects/${projectId}`,
      headers: { cookie: adminCookie, origin },
      payload: {
        hoursPerWorkday: 7.5,
        workdaysPerWeek: 5,
        nonWorkingDays: ['2026-10-09'],
      },
    });
    expect(saved.statusCode).toBe(200);
    const project = (saved.json() as {
      project: {
        hoursPerWorkday: number;
        workdaysPerWeek: number;
        nonWorkingDays: string[];
        finishDate: string | null;
        durationWorkingDays: number | null;
      };
    }).project;
    expect(project.hoursPerWorkday).toBe(7.5);
    expect(project.workdaysPerWeek).toBe(5);
    expect(project.nonWorkingDays).toEqual(['2026-10-09']);
    expect(project.finishDate).toBeNull();
    expect(project.durationWorkingDays).toBeNull();

    const early = await createTask(projectId, {
      title: 'Before the holiday',
      startDate: '2026-10-08',
      durationDays: 1,
    });
    expect(early.dueDate).toBe('2026-10-12');

    const successor = await createTask(projectId, {
      title: 'After the holiday',
      durationDays: 2,
    });
    const linked = await app!.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/delivery-dependencies`,
      headers: { cookie: adminCookie, origin },
      payload: {
        predecessorId: early.humanKey,
        successorId: successor.humanKey,
        linkType: 'FS',
        lagDays: 1,
      },
    });
    expect(linked.statusCode).toBe(200);
    const write = (linked.json() as {
      schedule: Array<{ id: string; startDate: string | null; finishDate: string | null }>;
    }).schedule.find((row) => row.id === successor.id);
    expect(write).toMatchObject({
      startDate: '2026-10-13',
      finishDate: '2026-10-15',
    });

    const read = await app!.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}`,
      headers: { cookie: adminCookie },
    });
    expect(read.statusCode).toBe(200);
    const planned = (read.json() as {
      project: {
        finishDate: string | null;
        forecastFinishDate: string | null;
        baselineFinishDate: string | null;
        durationWorkingDays: number | null;
      };
    }).project;
    expect(planned.finishDate).toBe('2026-10-15');
    expect(planned.forecastFinishDate).toBe('2026-10-15');
    expect(planned.baselineFinishDate).toBeNull();
    expect(planned.durationWorkingDays).toBeNull();
  });

  it('counts inclusive baseline duration and applies an approved schedule change (PRO-B-41, PRO-B-40)', async () => {
    const projectId = await createProject('DPF');
    const note = await app!.inject({
      method: 'POST',
      url: '/api/v1/knowledge-records',
      headers: { cookie: adminCookie, origin },
      payload: {
        workspaceId,
        projectId,
        title: 'Kickoff notes',
        recordType: 'note',
        contentMarkdown: 'Notes',
      },
    });
    expect(note.statusCode).toBe(200);
    const record = (note.json() as {
      knowledgeRecord: { id: string; humanKey: string | null; title: string };
    }).knowledgeRecord;

    const pinned = await app!.inject({
      method: 'PATCH',
      url: `/api/v1/projects/${projectId}`,
      headers: { cookie: adminCookie, origin },
      payload: {
        charterRecordId: record.id,
        startDate: '2026-08-01',
        endDate: '2026-10-22',
        workdaysPerWeek: 5,
        nonWorkingDays: ['2026-08-20', '2026-08-21'],
      },
    });
    expect(pinned.statusCode).toBe(200);
    const baseline = (pinned.json() as {
      project: {
        durationWorkingDays: number | null;
        baselineFinishDate: string | null;
        finishDate: string | null;
        charterRecord: { humanKey: string | null; title: string; recordType: string } | null;
      };
    }).project;
    expect(baseline.durationWorkingDays).toBe(57);
    expect(baseline.baselineFinishDate).toBe('2026-10-22');
    expect(baseline.finishDate).toBeNull();
    expect(baseline.charterRecord).toMatchObject({
      title: 'Kickoff notes',
      recordType: 'note',
      humanKey: record.humanKey,
    });

    const oneDay = await app!.inject({
      method: 'PATCH',
      url: `/api/v1/projects/${projectId}`,
      headers: { cookie: adminCookie, origin },
      payload: {
        startDate: '2026-10-05',
        endDate: '2026-10-05',
        nonWorkingDays: [],
      },
    });
    expect(oneDay.statusCode).toBe(200);
    expect(
      (oneDay.json() as { project: { durationWorkingDays: number | null } }).project
        .durationWorkingDays,
    ).toBe(1);

    const restored = await app!.inject({
      method: 'PATCH',
      url: `/api/v1/projects/${projectId}`,
      headers: { cookie: adminCookie, origin },
      payload: {
        startDate: '2026-08-01',
        endDate: '2026-10-22',
        nonWorkingDays: ['2026-08-20', '2026-08-21'],
      },
    });
    expect(restored.statusCode).toBe(200);

    const created = await app!.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/change-items`,
      headers: { cookie: adminCookie, origin },
      payload: {
        kind: 'timeline',
        title: 'Move the approved finish',
        status: 'approved',
        baselineEndBefore: '2026-10-22',
        baselineEndAfter: '2026-11-02',
      },
    });
    expect(created.statusCode).toBe(200);
    const changeId = (created.json() as { changeItem: { id: string } }).changeItem.id;

    const applied = await app!.inject({
      method: 'POST',
      url: `/api/v1/project-change-items/${changeId}/apply-baseline`,
      headers: { cookie: adminCookie, origin },
    });
    expect(applied.statusCode).toBe(200);
    const applyBody = applied.json() as {
      applied: boolean;
      changeItem: { status: string; baselineAppliedAt: string | null };
    };
    expect(applyBody.applied).toBe(true);
    expect(applyBody.changeItem.status).toBe('implemented');
    expect(applyBody.changeItem.baselineAppliedAt).toBeTruthy();

    const again = await app!.inject({
      method: 'POST',
      url: `/api/v1/project-change-items/${changeId}/apply-baseline`,
      headers: { cookie: adminCookie, origin },
    });
    expect(again.statusCode).toBe(200);
    expect((again.json() as { applied: boolean }).applied).toBe(false);

    const read = await app!.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}`,
      headers: { cookie: adminCookie },
    });
    const project = (read.json() as {
      project: { endDate: string | null; baselineFinishDate: string | null };
    }).project;
    expect(project.endDate).toBe('2026-11-02');
    expect(project.baselineFinishDate).toBe('2026-11-02');

    const audits = await database!.db
      .select({ action: auditEvents.action, metadataJson: auditEvents.metadataJson })
      .from(auditEvents)
      .where(eq(auditEvents.entityId, changeId));
    const appliedAudits = audits.filter((row) => row.action === 'project.change_baseline_applied');
    expect(appliedAudits).toHaveLength(1);
    const metadata = appliedAudits[0]?.metadataJson as {
      changeKey?: string | null;
      baselineEndBefore?: string | null;
      baselineEndAfter?: string | null;
      durationWorkingDaysBefore?: number | null;
      budgetDelta?: number | null;
      actorUserId?: string | null;
    };
    expect(metadata.baselineEndBefore).toBe('2026-10-22');
    expect(metadata.baselineEndAfter).toBe('2026-11-02');
    expect(metadata.durationWorkingDaysBefore).toBe(57);
    expect(metadata.budgetDelta).toBe(0);
    expect(metadata.actorUserId).toBeTruthy();
    expect(metadata.changeKey == null || typeof metadata.changeKey === 'string').toBe(true);

    const proposed = await app!.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/change-items`,
      headers: { cookie: adminCookie, origin },
      payload: {
        kind: 'timeline',
        title: 'Approve without writing',
        status: 'proposed',
        baselineEndAfter: '2026-12-31',
      },
    });
    expect(proposed.statusCode).toBe(200);
    const proposedId = (proposed.json() as { changeItem: { id: string } }).changeItem.id;
    const approvedOnly = await app!.inject({
      method: 'PATCH',
      url: `/api/v1/project-change-items/${proposedId}`,
      headers: { cookie: adminCookie, origin },
      payload: { status: 'approved' },
    });
    expect(approvedOnly.statusCode).toBe(200);
    expect((approvedOnly.json() as { applied: boolean }).applied).toBe(false);
    const still = await app!.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}`,
      headers: { cookie: adminCookie },
    });
    expect((still.json() as { project: { endDate: string | null } }).project.endDate).toBe('2026-11-02');

    const confirmed = await app!.inject({
      method: 'PATCH',
      url: `/api/v1/project-change-items/${proposedId}`,
      headers: { cookie: adminCookie, origin },
      payload: { status: 'approved', confirmBaseline: true },
    });
    expect(confirmed.statusCode).toBe(200);
    const confirmedBody = confirmed.json() as {
      applied: boolean;
      changeItem: { status: string; baselineAppliedAt: string | null; baselineAppliedByUserId: string | null };
    };
    expect(confirmedBody.applied).toBe(true);
    expect(confirmedBody.changeItem.status).toBe('implemented');
    expect(confirmedBody.changeItem.baselineAppliedAt).toBeTruthy();
    expect(confirmedBody.changeItem.baselineAppliedByUserId).toBeTruthy();
    const moved = await app!.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}`,
      headers: { cookie: adminCookie },
    });
    expect((moved.json() as { project: { endDate: string | null } }).project.endDate).toBe('2026-12-31');
  });
});
