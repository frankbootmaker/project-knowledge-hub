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
import { allocateGlobalIntegrationKeyPrefix } from '../integration-test/unique-key-prefix.js';
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

function toolText(response: { json: () => unknown }): {
  isError: boolean;
  text: string;
  data: Record<string, unknown>;
} {
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

describe.skipIf(!hasIntegrationEnv)('batch MCP regressions', () => {
  let app: FastifyInstance | undefined;
  let redis: Redis | undefined;
  let closeDatabase: (() => Promise<void>) | undefined;
  let adminCookie = '';
  let workspaceA = '';
  let workspaceB = '';
  let workspaceBName = '';
  let projectA = '';
  let projectB = '';
  let projectC = '';
  let narrowToken = '';
  let wideToken = '';
  let validationToken = '';
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

    const suffix = randomUUID().slice(0, 8);
    const [org] = await database.db
      .insert(organizations)
      .values({ name: `Batch ${suffix}`, slug: `batch-${suffix}` })
      .returning();
    const [admin] = await database.db
      .insert(users)
      .values({
        email: `batch-${suffix}@example.com`,
        displayName: 'Batch Admin',
        passwordHash: await hashPassword('test-password-123'),
        isSystemAdmin: true,
        status: 'active',
      })
      .returning();
    const [wsA] = await database.db
      .insert(workspaces)
      .values({
        organizationId: org!.id,
        name: `Alpha ${suffix}`,
        slug: `alpha-${suffix}`,
      })
      .returning();
    const [wsB] = await database.db
      .insert(workspaces)
      .values({
        organizationId: org!.id,
        name: `Beta ${suffix}`,
        slug: `beta-${suffix}`,
      })
      .returning();
    workspaceA = wsA!.id;
    workspaceB = wsB!.id;
    workspaceBName = wsB!.name;
    await database.db.insert(memberships).values([
      { userId: admin!.id, workspaceId: workspaceA, role: 'workspace_admin' },
      { userId: admin!.id, workspaceId: workspaceB, role: 'workspace_admin' },
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

    async function createProject(
      workspaceId: string,
      name: string,
      keyPrefix: string,
    ): Promise<string> {
      const response = await app!.inject({
        method: 'POST',
        url: '/api/v1/projects',
        headers: { cookie: adminCookie, origin },
        payload: { workspaceId, name, keyPrefix, status: 'active' },
      });
      expect(response.statusCode).toBe(200);
      return (response.json() as { project: { id: string } }).project.id;
    }

    projectA = await createProject(
      workspaceA,
      'Project Alpha',
      await allocateGlobalIntegrationKeyPrefix(database),
    );
    projectB = await createProject(
      workspaceB,
      'Project Beta',
      await allocateGlobalIntegrationKeyPrefix(database),
    );
    projectC = await createProject(
      workspaceA,
      'Project Gamma',
      await allocateGlobalIntegrationKeyPrefix(database),
    );

    const scopes = [...DEFAULT_MCP_SCOPES, 'knowledge:write', 'pm:read', 'pm:write'];
    const narrow = await app.inject({
      method: 'POST',
      url: '/api/v1/api-clients',
      headers: { cookie: adminCookie, origin },
      payload: {
        organizationId: org!.id,
        name: 'Narrow token',
        scopes,
        allowedWorkspaceIds: [workspaceA],
        allowedProjectIds: [projectA],
        actingUserId: admin!.id,
      },
    });
    expect(narrow.statusCode).toBe(200);
    narrowToken = (narrow.json() as { token: string }).token;

    const wide = await app.inject({
      method: 'POST',
      url: '/api/v1/api-clients',
      headers: { cookie: adminCookie, origin },
      payload: {
        organizationId: org!.id,
        name: 'Wide token',
        scopes,
        allowedWorkspaceIds: [workspaceA, workspaceB],
        actingUserId: admin!.id,
      },
    });
    expect(wide.statusCode).toBe(200);
    wideToken = (wide.json() as { token: string }).token;

    const validation = await app.inject({
      method: 'POST',
      url: '/api/v1/api-clients',
      headers: { cookie: adminCookie, origin },
      payload: {
        organizationId: org!.id,
        name: 'Validation token',
        scopes,
        allowedWorkspaceIds: [workspaceA, workspaceB],
        actingUserId: admin!.id,
      },
    });
    expect(validation.statusCode).toBe(200);
    validationToken = (validation.json() as { token: string }).token;
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

  async function call(
    token: string,
    name: string,
    args: Record<string, unknown>,
  ) {
    const response = await mcpCall(app!, token, callId, name, args);
    callId += 1;
    expect(response.statusCode).toBe(200);
    return toolText(response);
  }

  it('PRO-T-23 lists out-of-scope projects and explains the allow-list', async () => {
    const listed = await call(narrowToken, 'list_projects', {});
    expect(listed.isError).toBe(false);
    const projects = listed.data.projects as Array<{ id: string }>;
    const hidden = listed.data.inaccessibleProjects as Array<{
      id: string;
      reason: string;
    }>;
    expect(projects.map((row) => row.id)).toContain(projectA);
    expect(projects.map((row) => row.id)).not.toContain(projectB);
    expect(projects.map((row) => row.id)).not.toContain(projectC);
    const beta = hidden.find((row) => row.id === projectB);
    const gamma = hidden.find((row) => row.id === projectC);
    expect(beta?.reason).toContain('allow-list');
    expect(beta?.reason).toContain(workspaceBName);
    expect(beta?.reason).not.toBe('Workspace is not allowed for this API client');
    expect(gamma?.reason).toContain('project allow-list');

    const fetched = await call(narrowToken, 'get_project', { projectId: projectB });
    expect(fetched.isError).toBe(true);
    expect(fetched.text).toContain('Project Beta');
    expect(fetched.text).toContain('allow-list');
    expect(fetched.text).toContain("token's scope");
    expect(fetched.text).not.toBe('Workspace is not allowed for this API client');
  });

  it('PRO-T-35 rejects an unknown recordType with the allowed list', async () => {
    const created = await call(wideToken, 'create_knowledge_record', {
      workspaceId: workspaceA,
      projectId: projectA,
      title: 'Typed note',
      recordType: 'note',
      contentMarkdown: '# Note\n',
    });
    expect(created.isError).toBe(false);
    const recordId = (created.data.knowledgeRecord as { id: string }).id;

    const updated = await call(wideToken, 'update_knowledge_record', {
      recordId,
      recordType: 'not-a-real-type',
      changeMessage: 'bad type',
    });
    expect(updated.isError).toBe(true);
    expect(updated.text).toContain('Invalid recordType');
    expect(updated.text).toContain('note');
    expect(updated.text).toContain('overview');
    expect(updated.text).not.toContain('Internal error');
  });

  it('PRO-T-36 restores an archived record by document key', async () => {
    const created = await call(wideToken, 'create_knowledge_record', {
      workspaceId: workspaceA,
      projectId: projectA,
      title: 'Archive me',
      recordType: 'note',
      contentMarkdown: '# Archive\n',
    });
    expect(created.isError).toBe(false);
    const record = created.data.knowledgeRecord as { id: string; humanKey: string };
    expect(record.humanKey).toBeTruthy();

    const archived = await call(wideToken, 'update_knowledge_record', {
      recordId: record.humanKey,
      archived: true,
      changeMessage: 'archive',
    });
    expect(archived.isError).toBe(false);

    const restored = await call(wideToken, 'update_knowledge_record', {
      recordId: record.humanKey,
      archived: false,
      changeMessage: 'restore',
    });
    expect(restored.isError).toBe(false);
    expect(restored.text).not.toContain('No knowledge record found');
    const body = restored.data.knowledgeRecord as { archivedAt: string | null };
    expect(body.archivedAt).toBeNull();
  });

  it('PRO-T-37 reports a cross-project task key on RAID links', async () => {
    const raid = await call(wideToken, 'create_project_raid_item', {
      projectId: projectA,
      kind: 'risk',
      title: 'Cross project risk',
    });
    expect(raid.isError).toBe(false);
    const raidKey = (raid.data.raidItem as { humanKey: string }).humanKey;

    const task = await call(wideToken, 'create_project_task', {
      projectId: projectC,
      title: 'Other project task',
    });
    expect(task.isError).toBe(false);
    const taskKey = (task.data.task as { humanKey: string }).humanKey;

    const linked = await call(wideToken, 'set_project_raid_task_links', {
      raidItemId: raidKey,
      taskIds: [taskKey],
    });
    expect(linked.isError).toBe(true);
    expect(linked.text).toContain(taskKey);
    expect(linked.text).toContain('does not belong to project');
    expect(linked.text).not.toContain('No project found for key');
  });

  it('PRO-T-50 rejects a foreign knowledge record on change update', async () => {
    const foreign = await call(wideToken, 'create_knowledge_record', {
      workspaceId: workspaceB,
      projectId: projectB,
      title: 'Other workspace doc',
      recordType: 'note',
      contentMarkdown: '# Other\n',
    });
    expect(foreign.isError).toBe(false);
    const foreignId = (foreign.data.knowledgeRecord as { id: string }).id;

    const sibling = await call(wideToken, 'create_knowledge_record', {
      workspaceId: workspaceA,
      projectId: projectC,
      title: 'Sibling project doc',
      recordType: 'note',
      contentMarkdown: '# Sibling\n',
    });
    expect(sibling.isError).toBe(false);
    const siblingId = (sibling.data.knowledgeRecord as { id: string }).id;

    const created = await call(wideToken, 'create_project_change_item', {
      projectId: projectA,
      kind: 'scope',
      title: 'Change with foreign doc',
      knowledgeRecordId: foreignId,
    });
    expect(created.isError).toBe(true);
    expect(created.text).toContain('must belong to this project');

    const change = await call(wideToken, 'create_project_change_item', {
      projectId: projectA,
      kind: 'scope',
      title: 'Empty change',
    });
    expect(change.isError).toBe(false);
    const changeId = (change.data.changeItem as { id: string }).id;

    const updated = await call(wideToken, 'update_project_change_item', {
      changeId,
      knowledgeRecordId: foreignId,
    });
    expect(updated.isError).toBe(true);
    expect(updated.text).toContain('must belong to this project');

    const siblingUpdate = await call(wideToken, 'update_project_change_item', {
      changeId,
      knowledgeRecordId: siblingId,
    });
    expect(siblingUpdate.isError).toBe(true);
    expect(siblingUpdate.text).toContain('must belong to this project');
  });

  it('PRO-T-51 keeps committed points after unfinished tasks move', async () => {
    const sprint = await call(wideToken, 'create_project_sprint', {
      projectId: projectA,
      name: 'Snapshot sprint',
      startDate: '2026-10-01',
      endDate: '2026-10-14',
      status: 'active',
    });
    expect(sprint.isError).toBe(false);
    const sprintId = (sprint.data.sprint as { id: string }).id;

    const done = await call(wideToken, 'create_project_task', {
      projectId: projectA,
      title: 'Finished work',
      sprintId,
      storyPoints: 5,
      status: 'done',
    });
    expect(done.isError).toBe(false);
    const doneId = (done.data.task as { id: string }).id;

    const open = await call(wideToken, 'create_project_task', {
      projectId: projectA,
      title: 'Leftover work',
      sprintId,
      storyPoints: 8,
      status: 'todo',
    });
    expect(open.isError).toBe(false);

    const closed = await call(wideToken, 'update_project_sprint', {
      sprintId,
      status: 'completed',
      unfinishedDestination: 'backlog',
    });
    expect(closed.isError).toBe(false);
    expect((closed.data.sprint as { committedPoints: number }).committedPoints).toBe(13);

    const burndown = await call(wideToken, 'get_project_sprint_burndown', { sprintId });
    expect(burndown.isError).toBe(false);
    const series = burndown.data.burndown as {
      committedPoints: number;
      points: Array<{ remaining: number }>;
    };
    expect(series.committedPoints).toBe(13);
    expect(series.points.length).toBeGreaterThan(0);
    expect(series.points[0]?.remaining).toBe(8);

    const rewritten = await call(wideToken, 'update_project_task', {
      taskId: doneId,
      storyPoints: 1,
    });
    expect(rewritten.isError).toBe(false);

    const again = await call(wideToken, 'get_project_sprint_burndown', { sprintId });
    expect(
      (again.data.burndown as { committedPoints: number }).committedPoints,
    ).toBe(13);
    const listed = await call(wideToken, 'list_project_sprints', { projectId: projectA });
    const rows = listed.data.sprints as Array<{ id: string; committedPoints: number }>;
    expect(rows.find((row) => row.id === sprintId)?.committedPoints).toBe(13);
  });

  it('says an outside item is outside the workspace and drops the ChatGPT hint', async () => {
    const task = await call(wideToken, 'create_project_task', {
      projectId: projectB,
      title: 'Beta task',
    });
    expect(task.isError).toBe(false);
    const taskKey = (task.data.task as { humanKey: string }).humanKey;

    const cross = await call(wideToken, 'begin_workspace_media_upload', {
      workspaceId: workspaceA,
      contentType: 'image/png',
      targetEntityType: 'task',
      targetEntityId: taskKey,
    });
    expect(cross.isError).toBe(true);
    expect(cross.text).toContain('The item is outside the workspace');
    expect(cross.text).not.toContain('Media must belong to the project workspace');

    const started = await call(wideToken, 'begin_workspace_media_upload', {
      workspaceId: workspaceA,
      contentType: 'image/png',
    });
    expect(started.isError).toBe(false);
    const hint = String(started.data.hint ?? '');
    expect(hint.startsWith('ChatGPT:')).toBe(false);
    expect(hint).toContain('append_workspace_media_upload');
  });

  it('PRO-B-22 does not create a change item for a foreign knowledge record', async () => {
    const foreign = await call(validationToken, 'create_knowledge_record', {
      workspaceId: workspaceB,
      projectId: projectB,
      title: 'Foreign charter',
      recordType: 'note',
      contentMarkdown: '# Foreign\n',
    });
    expect(foreign.isError).toBe(false);
    const foreignRecord = foreign.data.knowledgeRecord as {
      id: string;
      humanKey: string;
    };
    expect(foreignRecord.humanKey).toBeTruthy();

    const before = await call(validationToken, 'list_project_change_items', {
      projectId: projectA,
    });
    expect(before.isError).toBe(false);
    const beforeItems = before.data.changeItems as Array<{
      title: string;
      issueNumber: number;
    }>;
    const beforeMax = beforeItems.reduce(
      (max, item) => Math.max(max, item.issueNumber),
      0,
    );

    const attempts = [
      {
        title: 'Foreign key',
        knowledgeRecordId: foreignRecord.humanKey,
      },
      {
        title: 'Foreign uuid',
        knowledgeRecordId: foreignRecord.id,
      },
      {
        title: 'Foreign recordIds',
        recordIds: [foreignRecord.id],
      },
    ];
    for (const attempt of attempts) {
      const created = await call(validationToken, 'create_project_change_item', {
        projectId: projectA,
        kind: 'scope',
        title: attempt.title,
        ...('recordIds' in attempt
          ? { recordIds: attempt.recordIds }
          : { knowledgeRecordId: attempt.knowledgeRecordId }),
      });
      expect(created.isError, created.text).toBe(true);
      expect(created.text).toContain('must belong to this project');
    }

    const after = await call(validationToken, 'list_project_change_items', {
      projectId: projectA,
    });
    const afterItems = after.data.changeItems as Array<{
      title: string;
      issueNumber: number;
      knowledgeRecordId: string | null;
    }>;
    expect(afterItems).toHaveLength(beforeItems.length);
    for (const title of attempts.map((attempt) => attempt.title)) {
      expect(afterItems.some((item) => item.title === title)).toBe(false);
    }

    const local = await call(validationToken, 'create_knowledge_record', {
      workspaceId: workspaceA,
      projectId: projectA,
      title: 'Local note',
      recordType: 'note',
      contentMarkdown: '# Local\n',
    });
    expect(local.isError).toBe(false);
    const localId = (local.data.knowledgeRecord as { id: string }).id;
    const saved = await call(validationToken, 'create_project_change_item', {
      projectId: projectA,
      kind: 'scope',
      title: 'Local recordIds',
      recordIds: [localId],
    });
    expect(saved.isError, saved.text).toBe(false);
    const savedItem = saved.data.changeItem as {
      issueNumber: number;
      knowledgeRecordId: string | null;
    };
    expect(savedItem.issueNumber).toBe(beforeMax + 1);
    expect(savedItem.knowledgeRecordId).toBe(localId);
  });

  it('PRO-B-23 names the entity for a cross-project link key', async () => {
    const project = await call(validationToken, 'get_project', { projectId: projectA });
    expect(project.isError).toBe(false);
    const prefix = (project.data.project as { keyPrefix: string }).keyPrefix;

    const task = await call(validationToken, 'create_project_task', {
      projectId: projectC,
      title: 'Gamma task',
    });
    expect(task.isError).toBe(false);
    const taskKey = (task.data.task as { humanKey: string }).humanKey;

    const foreignTask = await call(validationToken, 'create_project_task', {
      projectId: projectB,
      title: 'Beta task for prefix',
    });
    expect(foreignTask.isError).toBe(false);
    const foreignTaskKey = (foreignTask.data.task as { humanKey: string }).humanKey;

    const record = await call(validationToken, 'create_knowledge_record', {
      workspaceId: workspaceA,
      projectId: projectA,
      title: 'Link host',
      recordType: 'note',
      contentMarkdown: '# Host\n',
    });
    expect(record.isError).toBe(false);
    const recordKey = (record.data.knowledgeRecord as { humanKey: string }).humanKey;

    const foreignRecord = await call(validationToken, 'create_knowledge_record', {
      workspaceId: workspaceA,
      projectId: projectC,
      title: 'Gamma note',
      recordType: 'note',
      contentMarkdown: '# Gamma\n',
    });
    expect(foreignRecord.isError).toBe(false);
    const foreignRecordKey = (foreignRecord.data.knowledgeRecord as { humanKey: string }).humanKey;

    const raid = await call(validationToken, 'create_project_raid_item', {
      projectId: projectA,
      kind: 'issue',
      title: 'Host issue',
    });
    expect(raid.isError).toBe(false);
    const raidKey = (raid.data.raidItem as { humanKey: string }).humanKey;

    const foreignRaid = await call(validationToken, 'create_project_raid_item', {
      projectId: projectC,
      kind: 'risk',
      title: 'Gamma risk',
    });
    expect(foreignRaid.isError).toBe(false);
    const foreignRaidKey = (foreignRaid.data.raidItem as { humanKey: string }).humanKey;

    const change = await call(validationToken, 'create_project_change_item', {
      projectId: projectA,
      kind: 'timeline',
      title: 'Host change',
    });
    expect(change.isError).toBe(false);
    const changeKey = (change.data.changeItem as { humanKey: string }).humanKey;

    const milestone = await call(validationToken, 'create_project_milestone', {
      projectId: projectA,
      title: 'Host milestone',
    });
    expect(milestone.isError).toBe(false);
    const milestoneKey = (milestone.data.milestone as { humanKey: string }).humanKey;

    const bug = await call(validationToken, 'create_project_task', {
      projectId: projectA,
      title: 'Host bug',
      itemType: 'bug',
    });
    expect(bug.isError).toBe(false);
    const bugKey = (bug.data.task as { humanKey: string }).humanKey;

    const raidBefore = await call(validationToken, 'list_project_raid_items', {
      projectId: projectA,
    });
    const raidCount = (raidBefore.data.raidItems as unknown[]).length;

    function expectScoped(result: { isError: boolean; text: string }, key: string) {
      expect(result.isError, result.text).toBe(true);
      expect(result.text).toContain(key);
      expect(result.text).toContain(prefix);
      expect(result.text).not.toContain('No project found for key prefix');
      expect(
        result.text.includes('does not belong to project')
        || result.text.includes('not found in project'),
      ).toBe(true);
    }

    expectScoped(
      await call(validationToken, 'set_knowledge_record_delivery_links', {
        recordId: recordKey,
        links: [{ entityType: 'task', entityId: taskKey }],
      }),
      taskKey,
    );
    expectScoped(
      await call(validationToken, 'set_knowledge_record_delivery_links', {
        recordId: recordKey,
        links: [{ entityType: 'task', entityId: foreignTaskKey }],
      }),
      foreignTaskKey,
    );
    expectScoped(
      await call(validationToken, 'set_project_raid_record_links', {
        raidItemId: raidKey,
        recordIds: [foreignRecordKey],
      }),
      foreignRecordKey,
    );
    expectScoped(
      await call(validationToken, 'update_project_change_item', {
        changeId: changeKey,
        deliveryLinks: [{ entityType: 'task', entityId: taskKey }],
      }),
      taskKey,
    );
    const raidCreate = await call(validationToken, 'create_project_raid_item', {
      projectId: projectA,
      kind: 'issue',
      title: 'Should not exist',
      taskIds: [taskKey],
    });
    expectScoped(raidCreate, taskKey);
    const raidRecords = await call(validationToken, 'create_project_raid_item', {
      projectId: projectA,
      kind: 'issue',
      title: 'Should not exist either',
      recordIds: [foreignRecordKey],
    });
    expectScoped(raidRecords, foreignRecordKey);
    const raidAfter = await call(validationToken, 'list_project_raid_items', {
      projectId: projectA,
    });
    expect((raidAfter.data.raidItems as unknown[]).length).toBe(raidCount);
    expectScoped(
      await call(validationToken, 'set_knowledge_record_raid_links', {
        recordId: recordKey,
        raidItemIds: [foreignRaidKey],
      }),
      foreignRaidKey,
    );
    expectScoped(
      await call(validationToken, 'set_project_milestone_item_links', {
        milestoneId: milestoneKey,
        items: [{ entityType: 'task', entityId: taskKey }],
      }),
      taskKey,
    );
    expectScoped(
      await call(validationToken, 'set_delivery_media_links', {
        projectId: projectA,
        entityType: 'task',
        entityId: taskKey,
        links: [],
      }),
      taskKey,
    );
    expectScoped(
      await call(validationToken, 'update_project_task', {
        taskId: bugKey,
        resolution: 'duplicate',
        duplicateOfTaskId: taskKey,
      }),
      taskKey,
    );
  });

  it('PRO-B-24 rejects an unknown currency and normalises lowercase', async () => {
    const rejected = await call(validationToken, 'create_ai_billing_entry', {
      workspaceId: workspaceA,
      provider: 'QA',
      type: 'on_demand',
      amount: 1,
      currency: 'XYZ',
      period: '2026-10',
    });
    expect(rejected.isError).toBe(true);
    expect(rejected.text).toContain('Invalid currency "XYZ"');
    expect(rejected.text).toContain('EUR');
    expect(rejected.text).not.toContain('Internal error');

    const digits = await call(validationToken, 'create_ai_billing_entry', {
      workspaceId: workspaceA,
      provider: 'QA',
      type: 'on_demand',
      amount: 1,
      currency: '123',
      period: '2026-10',
    });
    expect(digits.isError).toBe(true);
    expect(digits.text).toContain('Invalid currency "123"');
    expect(digits.text).not.toContain('Internal error');

    const created = await call(validationToken, 'create_ai_billing_entry', {
      workspaceId: workspaceA,
      provider: 'QA',
      type: 'on_demand',
      amount: 1,
      currency: 'eur',
      period: '2026-10',
    });
    expect(created.isError, created.text).toBe(false);
    const entry = created.data.entry as { id: string; currency: string };
    expect(entry.currency).toBe('EUR');

    const updatedBad = await call(validationToken, 'update_ai_billing_entry', {
      entryId: entry.id,
      currency: 'ABC',
    });
    expect(updatedBad.isError).toBe(true);
    expect(updatedBad.text).toContain('Invalid currency "ABC"');
    expect(updatedBad.text).not.toContain('Internal error');

    const updated = await call(validationToken, 'update_ai_billing_entry', {
      entryId: entry.id,
      currency: 'usd',
    });
    expect(updated.isError, updated.text).toBe(false);
    expect((updated.data.entry as { currency: string }).currency).toBe('USD');

    const listed = await call(validationToken, 'list_ai_billing_entries', {
      workspaceId: workspaceA,
    });
    const rows = listed.data.entries as Array<{ id: string; currency: string }>;
    expect(rows.find((row) => row.id === entry.id)?.currency).toBe('USD');
  });

  it('PRO-B-27 removes a symmetric relation from the higher-uuid record', async () => {
    const left = await call(validationToken, 'create_knowledge_record', {
      workspaceId: workspaceA,
      projectId: projectA,
      title: 'Relation left',
      recordType: 'note',
      contentMarkdown: '# Left\n',
    });
    const right = await call(validationToken, 'create_knowledge_record', {
      workspaceId: workspaceA,
      projectId: projectA,
      title: 'Relation right',
      recordType: 'note',
      contentMarkdown: '# Right\n',
    });
    expect(left.isError).toBe(false);
    expect(right.isError).toBe(false);
    const records = [
      left.data.knowledgeRecord as { id: string; humanKey: string },
      right.data.knowledgeRecord as { id: string; humanKey: string },
    ].sort((a, b) => a.id.localeCompare(b.id));
    const lower = records[0]!;
    const higher = records[1]!;

    const set = await call(validationToken, 'set_knowledge_record_relations', {
      recordId: higher.humanKey,
      links: [
        { targetRecordId: lower.humanKey, relationType: 'relates_to' },
        { targetRecordId: lower.id, relationType: 'derived_from' },
      ],
    });
    expect(set.isError, set.text).toBe(false);
    const outbound = (
      set.data.relations as { outbound: Array<{ relationType: string }> }
    ).outbound.map((edge) => edge.relationType);
    expect(outbound).toContain('relates_to');
    expect(outbound).toContain('derived_from');
    expect(
      (set.data.relations as { inbound: unknown[] }).inbound,
    ).toEqual([]);

    const cleared = await call(validationToken, 'set_knowledge_record_relations', {
      recordId: higher.id,
      links: [],
    });
    expect(cleared.isError, cleared.text).toBe(false);
    expect(cleared.data.relations).toMatchObject({ outbound: [], inbound: [] });

    const contradicts = await call(validationToken, 'set_knowledge_record_relations', {
      recordId: higher.humanKey,
      links: [{ targetRecordId: lower.humanKey, relationType: 'contradicts' }],
    });
    expect(contradicts.isError, contradicts.text).toBe(false);
    const removed = await call(validationToken, 'set_knowledge_record_relations', {
      recordId: higher.humanKey,
      links: [],
    });
    expect(removed.isError, removed.text).toBe(false);
    expect(removed.data.relations).toMatchObject({ outbound: [], inbound: [] });

    const fromLower = await call(validationToken, 'set_knowledge_record_relations', {
      recordId: lower.humanKey,
      links: [{ targetRecordId: higher.humanKey, relationType: 'relates_to' }],
    });
    expect(fromLower.isError, fromLower.text).toBe(false);
    const clearedLower = await call(validationToken, 'set_knowledge_record_relations', {
      recordId: lower.humanKey,
      links: [],
    });
    expect(clearedLower.isError, clearedLower.text).toBe(false);
    const still = await call(validationToken, 'get_knowledge_record_relations', {
      recordId: higher.humanKey,
    });
    expect(still.isError).toBe(false);
    expect(still.data.relations).toMatchObject({ outbound: [], inbound: [] });
  });
});
