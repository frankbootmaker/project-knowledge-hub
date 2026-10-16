import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import { hashPassword } from '@project-knowledge-hub/auth';
import { loadEnv } from '@project-knowledge-hub/config';
import {
  createDatabase,
  knowledgeRecordDeliveryLinks,
  knowledgeRecords,
  memberships,
  organizations,
  projectRaidRecordLinks,
  users,
  workspaces,
} from '@project-knowledge-hub/database';
import { buildApp } from '../app.js';
import type { FastifyInstance } from 'fastify';

const hasIntegrationEnv = Boolean(process.env.DATABASE_URL) && Boolean(process.env.REDIS_URL);

function testEnv() {
  return loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    APP_ENV: 'test',
    LOG_LEVEL: 'silent',
    SESSION_SECRET: process.env.SESSION_SECRET ?? 'test-session-secret-at-least-32-chars',
    WEB_URL: process.env.WEB_URL ?? 'http://localhost:3100',
  });
}

type LinkedItem = {
  id: string;
  title: string;
  type: string;
  kind: string | null;
  projectId: string;
  projectSlug: string;
  humanKey: string | null;
};

type LinkedItems = {
  deliveryLinks: LinkedItem[];
  raidLinks: LinkedItem[];
  changeItems: LinkedItem[];
};

describe.skipIf(!hasIntegrationEnv)('knowledge record linked items', () => {
  let app: FastifyInstance | undefined;
  let redis: Redis | undefined;
  let closeDatabase: (() => Promise<void>) | undefined;
  let database: ReturnType<typeof createDatabase> | undefined;
  let adminCookie = '';
  let readerCookie = '';
  let outsiderCookie = '';
  let adminId = '';
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
        email: `admin-links-${suffix}@example.com`,
        displayName: 'Admin',
        passwordHash: await hashPassword(password),
        isSystemAdmin: true,
        status: 'active',
      })
      .returning();
    const [reader] = await database.db
      .insert(users)
      .values({
        email: `reader-links-${suffix}@example.com`,
        displayName: 'Reader',
        passwordHash: await hashPassword(password),
        isSystemAdmin: false,
        status: 'active',
      })
      .returning();
    const [outsider] = await database.db
      .insert(users)
      .values({
        email: `outsider-links-${suffix}@example.com`,
        displayName: 'Outsider',
        passwordHash: await hashPassword(password),
        isSystemAdmin: false,
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
    if (!org || !admin || !reader || !outsider || !workspace) {
      throw new Error('fixture missing');
    }
    adminId = admin.id;
    workspaceId = workspace.id;
    await database.db.insert(memberships).values([
      {
        userId: admin.id,
        workspaceId: workspace.id,
        role: 'workspace_admin',
      },
      {
        userId: reader.id,
        workspaceId: workspace.id,
        role: 'reader',
      },
    ]);

    app = await buildApp({ env, database, redis });
    await app.ready();

    async function login(email: string): Promise<string> {
      const response = await app!.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email, password },
      });
      const value = response.cookies.find(
        (cookie) => cookie.name === env.SESSION_COOKIE_NAME,
      )?.value;
      return `${env.SESSION_COOKIE_NAME}=${value}`;
    }

    adminCookie = await login(admin.email);
    readerCookie = await login(reader.email);
    outsiderCookie = await login(outsider.email);
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

  async function createProject(): Promise<{ id: string; slug: string }> {
    const response = await app!.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { cookie: adminCookie, origin },
      payload: { workspaceId, name: `Links ${randomUUID()}` },
    });
    expect(response.statusCode).toBe(200);
    return (response.json() as { project: { id: string; slug: string } }).project;
  }

  async function createRecord(projectId: string | null): Promise<string> {
    const suffix = randomUUID();
    const [row] = await database!.db
      .insert(knowledgeRecords)
      .values({
        workspaceId,
        projectId,
        title: `Note ${suffix}`,
        slug: `note-${suffix}`,
        recordType: 'note',
        createdBy: adminId,
      })
      .returning();
    if (!row) throw new Error('record missing');
    return row.id;
  }

  it('reads same-project links, hides archived RAID, and rejects cross-project records', async () => {
    const project = await createProject();
    const other = await createProject();
    const recordId = await createRecord(project.id);
    const otherRecordId = await createRecord(other.id);
    const unscopedRecordId = await createRecord(null);

    const epic = await app!.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.id}/epics`,
      headers: { cookie: adminCookie, origin },
      payload: { title: 'Charter epic' },
    });
    expect(epic.statusCode).toBe(200);
    const epicId = (epic.json() as { epic: { id: string } }).epic.id;

    const story = await app!.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.id}/user-stories`,
      headers: { cookie: adminCookie, origin },
      payload: { epicId, title: 'Charter story' },
    });
    expect(story.statusCode).toBe(200);
    const storyId = (story.json() as { userStory: { id: string } }).userStory.id;

    const milestone = await app!.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.id}/milestones`,
      headers: { cookie: adminCookie, origin },
      payload: { title: 'Charter milestone' },
    });
    expect(milestone.statusCode).toBe(200);
    const milestoneId = (milestone.json() as { milestone: { id: string } }).milestone.id;

    const task = await app!.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.id}/tasks`,
      headers: { cookie: adminCookie, origin },
      payload: { title: 'Charter task' },
    });
    expect(task.statusCode).toBe(200);
    const taskId = (task.json() as { task: { id: string } }).task.id;

    const bug = await app!.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.id}/tasks`,
      headers: { cookie: adminCookie, origin },
      payload: { title: 'Charter bug', itemType: 'bug' },
    });
    expect(bug.statusCode).toBe(200);
    const bugId = (bug.json() as { task: { id: string } }).task.id;

    const sprint = await app!.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.id}/sprints`,
      headers: { cookie: adminCookie, origin },
      payload: { name: 'Charter sprint' },
    });
    expect(sprint.statusCode).toBe(200);
    const sprintId = (sprint.json() as { sprint: { id: string } }).sprint.id;

    const linkedDocs = await app!.inject({
      method: 'PUT',
      url: `/api/v1/knowledge-records/${recordId}/delivery-links`,
      headers: { cookie: adminCookie, origin },
      payload: {
        links: [
          { entityType: 'epic', entityId: epicId },
          { entityType: 'user_story', entityId: storyId },
          { entityType: 'milestone', entityId: milestoneId },
          { entityType: 'task', entityId: taskId },
          { entityType: 'task', entityId: bugId },
          { entityType: 'sprint', entityId: sprintId },
        ],
      },
    });
    expect(linkedDocs.statusCode).toBe(200);

    const created = await app!.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.id}/raid-items`,
      headers: { cookie: adminCookie, origin },
      payload: {
        kind: 'risk',
        title: 'Open risk',
        recordIds: [recordId],
      },
    });
    expect(created.statusCode).toBe(200);
    const raidId = (created.json() as { raidItem: { id: string; records: Array<{ id: string }> } })
      .raidItem.id;
    expect(
      (created.json() as { raidItem: { records: Array<{ id: string }> } }).raidItem.records.map(
        (record) => record.id,
      ),
    ).toEqual([recordId]);

    const crossCreate = await app!.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.id}/raid-items`,
      headers: { cookie: adminCookie, origin },
      payload: {
        kind: 'issue',
        title: 'Cross project',
        recordIds: [otherRecordId],
      },
    });
    expect(crossCreate.statusCode).toBe(400);
    expect((crossCreate.json() as { error: { code: string } }).error.code).toBe(
      'RAID_RECORD_PROJECT_MISMATCH',
    );

    const archived = await app!.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.id}/raid-items`,
      headers: { cookie: adminCookie, origin },
      payload: {
        kind: 'assumption',
        title: 'Archived assumption',
        recordIds: [recordId],
      },
    });
    expect(archived.statusCode).toBe(200);
    const archivedId = (archived.json() as { raidItem: { id: string } }).raidItem.id;
    const archivedPatch = await app!.inject({
      method: 'PATCH',
      url: `/api/v1/project-raid-items/${archivedId}`,
      headers: { cookie: adminCookie, origin },
      payload: { archived: true },
    });
    expect(archivedPatch.statusCode).toBe(200);

    const change = await app!.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.id}/change-items`,
      headers: { cookie: adminCookie, origin },
      payload: {
        kind: 'scope',
        title: 'Scope change',
        recordIds: [recordId],
      },
    });
    expect(change.statusCode).toBe(200);
    const changeId = (change.json() as { changeItem: { id: string } }).changeItem.id;

    const archivedChange = await app!.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.id}/change-items`,
      headers: { cookie: adminCookie, origin },
      payload: {
        kind: 'other',
        title: 'Archived change',
        recordIds: [recordId],
      },
    });
    expect(archivedChange.statusCode).toBe(200);
    const archivedChangeId = (archivedChange.json() as { changeItem: { id: string } }).changeItem
      .id;
    const archivedChangePatch = await app!.inject({
      method: 'PATCH',
      url: `/api/v1/project-change-items/${archivedChangeId}`,
      headers: { cookie: adminCookie, origin },
      payload: { archived: true },
    });
    expect(archivedChangePatch.statusCode).toBe(200);

    const otherTask = await app!.inject({
      method: 'POST',
      url: `/api/v1/projects/${other.id}/tasks`,
      headers: { cookie: adminCookie, origin },
      payload: { title: 'Other task' },
    });
    expect(otherTask.statusCode).toBe(200);
    const otherTaskId = (otherTask.json() as { task: { id: string } }).task.id;
    await database!.db.insert(knowledgeRecordDeliveryLinks).values({
      knowledgeRecordId: recordId,
      entityType: 'task',
      entityId: otherTaskId,
      createdBy: adminId,
    });

    const otherRaid = await app!.inject({
      method: 'POST',
      url: `/api/v1/projects/${other.id}/raid-items`,
      headers: { cookie: adminCookie, origin },
      payload: { kind: 'dependency', title: 'Other raid' },
    });
    expect(otherRaid.statusCode).toBe(200);
    const otherRaidId = (otherRaid.json() as { raidItem: { id: string } }).raidItem.id;
    await database!.db.insert(projectRaidRecordLinks).values({
      raidItemId: otherRaidId,
      knowledgeRecordId: recordId,
      createdBy: adminId,
    });

    const read = await app!.inject({
      method: 'GET',
      url: `/api/v1/knowledge-records/${recordId}/linked-items`,
      headers: { cookie: adminCookie },
    });
    expect(read.statusCode).toBe(200);
    const linked = (read.json() as { linkedItems: LinkedItems }).linkedItems;

    expect(linked.deliveryLinks.map((item) => item.id).sort()).toEqual(
      [bugId, epicId, milestoneId, sprintId, storyId, taskId].sort(),
    );
    expect(linked.deliveryLinks.find((item) => item.id === bugId)?.kind).toBe('bug');
    expect(linked.deliveryLinks.find((item) => item.id === taskId)?.type).toBe('task');
    expect(linked.deliveryLinks.find((item) => item.id === sprintId)?.type).toBe('sprint');
    expect(linked.deliveryLinks.every((item) => item.projectId === project.id)).toBe(true);
    expect(linked.deliveryLinks.every((item) => item.projectSlug === project.slug)).toBe(true);
    expect(linked.deliveryLinks.some((item) => item.id === otherTaskId)).toBe(false);

    expect(linked.raidLinks.map((item) => item.id)).toEqual([raidId]);
    expect(linked.raidLinks[0]?.kind).toBe('risk');
    expect(linked.raidLinks.some((item) => item.id === archivedId)).toBe(false);
    expect(linked.raidLinks.some((item) => item.id === otherRaidId)).toBe(false);

    expect(linked.changeItems.map((item) => item.id)).toEqual([changeId]);
    expect(linked.changeItems[0]?.type).toBe('change');
    expect(linked.changeItems.some((item) => item.id === archivedChangeId)).toBe(false);

    const readerRead = await app!.inject({
      method: 'GET',
      url: `/api/v1/knowledge-records/${recordId}/linked-items`,
      headers: { cookie: readerCookie },
    });
    expect(readerRead.statusCode).toBe(200);

    const outsiderRead = await app!.inject({
      method: 'GET',
      url: `/api/v1/knowledge-records/${recordId}/linked-items`,
      headers: { cookie: outsiderCookie },
    });
    expect(outsiderRead.statusCode).toBe(403);

    const empty = await app!.inject({
      method: 'GET',
      url: `/api/v1/knowledge-records/${unscopedRecordId}/linked-items`,
      headers: { cookie: adminCookie },
    });
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toEqual({
      linkedItems: { deliveryLinks: [], raidLinks: [], changeItems: [] },
    });
  });
});
