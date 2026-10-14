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

const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

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

type MediaLink = {
  kind: 'media' | 'url';
  mediaId: string | null;
  url: string | null;
  title: string | null;
  deleted: boolean;
};

type ItemWithMedia = {
  id: string;
  humanKey: string | null;
  mediaLinkCount: number;
  mediaLinks: MediaLink[];
};

describe.skipIf(!hasIntegrationEnv)('MCP delivery media links', () => {
  let app: FastifyInstance | undefined;
  let redis: Redis | undefined;
  let closeDatabase: (() => Promise<void>) | undefined;
  let adminCookie = '';
  let workspaceId = '';
  let otherWorkspaceId = '';
  let projectId = '';
  let otherProjectId = '';
  let writeToken = '';
  let readToken = '';
  let knowledgeToken = '';
  let bothToken = '';
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
        email: `admin-media-mcp-${suffix}@example.com`,
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
    const [other] = await database.db
      .insert(workspaces)
      .values({
        organizationId: org?.id ?? '',
        name: `WS other ${suffix}`,
        slug: `ws-other-${suffix}`,
      })
      .returning();
    workspaceId = workspace?.id ?? '';
    otherWorkspaceId = other?.id ?? '';
    await database.db.insert(memberships).values([
      { userId: admin?.id ?? '', workspaceId, role: 'workspace_admin' },
      {
        userId: admin?.id ?? '',
        workspaceId: otherWorkspaceId,
        role: 'workspace_admin',
      },
    ]);

    app = await buildApp({ env, database, redis });
    await app.ready();

    const adminLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: admin?.email, password },
    });
    adminCookie = `${env.SESSION_COOKIE_NAME}=${adminLogin.cookies.find((c) => c.name === env.SESSION_COOKIE_NAME)?.value}`;

    const project = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { cookie: adminCookie, origin },
      payload: {
        workspaceId,
        name: 'Media MCP',
        status: 'active',
        keyPrefix: 'PRO',
      },
    });
    expect(project.statusCode).toBe(200);
    projectId = (project.json() as { project: { id: string } }).project.id;

    const otherProject = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { cookie: adminCookie, origin },
      payload: {
        workspaceId: otherWorkspaceId,
        name: 'Other media',
        status: 'active',
        keyPrefix: 'OTH',
      },
    });
    expect(otherProject.statusCode).toBe(200);
    otherProjectId = (otherProject.json() as { project: { id: string } }).project.id;

    async function clientToken(
      name: string,
      scopes: string[],
      workspaces: string[],
    ): Promise<string> {
      const created = await app!.inject({
        method: 'POST',
        url: '/api/v1/api-clients',
        headers: { cookie: adminCookie, origin },
        payload: {
          organizationId: org?.id,
          name,
          scopes,
          allowedWorkspaceIds: workspaces,
          actingUserId: admin?.id,
        },
      });
      expect(created.statusCode).toBe(200);
      return (created.json() as { token: string }).token;
    }

    writeToken = await clientToken(
      'MCP media writer',
      [...DEFAULT_MCP_SCOPES, 'knowledge:write', 'pm:read', 'pm:write'],
      [workspaceId],
    );
    readToken = await clientToken(
      'MCP media reader',
      [...DEFAULT_MCP_SCOPES, 'pm:read'],
      [workspaceId],
    );
    knowledgeToken = await clientToken(
      'MCP knowledge writer',
      [...DEFAULT_MCP_SCOPES, 'knowledge:write'],
      [workspaceId],
    );
    bothToken = await clientToken(
      'MCP both workspaces',
      [...DEFAULT_MCP_SCOPES, 'knowledge:write', 'pm:read', 'pm:write'],
      [workspaceId, otherWorkspaceId],
    );
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

  it('links an upload, an existing image, and a URL, then unlinks without deleting media', async () => {
    const epic = await call<{ epic?: ItemWithMedia }>(writeToken, 'create_project_epic', {
      projectId,
      title: 'Media epic',
    });
    expect(epic.isError).toBe(false);
    expect(epic.data.epic?.humanKey).toBe('PRO-E-1');

    const story = await call<{ userStory?: ItemWithMedia }>(
      writeToken,
      'create_project_user_story',
      { projectId, epicId: 'PRO-E-1', title: 'Media story' },
    );
    expect(story.isError).toBe(false);
    expect(story.data.userStory?.humanKey).toBe('PRO-S-1');

    const task = await call<{ task?: ItemWithMedia }>(writeToken, 'create_project_task', {
      projectId,
      title: 'Media task',
    });
    expect(task.isError).toBe(false);
    expect(task.data.task?.humanKey).toBe('PRO-T-1');

    const before = await call<{ task?: ItemWithMedia }>(readToken, 'get_project_task', {
      taskId: 'PRO-T-1',
    });
    expect(before.isError).toBe(false);
    expect(before.data.task?.mediaLinks).toEqual([]);
    expect(before.data.task?.mediaLinkCount).toBe(0);

    const begun = await call<{ uploadId?: string }>(
      writeToken,
      'begin_workspace_media_upload',
      {
        workspaceId,
        contentType: 'image/png',
        filename: 'close-out.png',
        alt: 'Close-out screenshot',
        targetEntityType: 'task',
        targetEntityId: 'PRO-T-1',
      },
    );
    expect(begun.isError).toBe(false);
    const uploadId = begun.data.uploadId;
    expect(uploadId).toBeTruthy();

    const appended = await call(writeToken, 'append_workspace_media_upload', {
      uploadId,
      chunkBase64: TINY_PNG,
      index: 0,
    });
    expect(appended.isError).toBe(false);

    const finalized = await call<{
      media?: { id: string; markdownSnippet: string };
      linkedTo?: { entityType: string; entityId: string };
    }>(writeToken, 'finalize_workspace_media_upload', { uploadId });
    expect(finalized.isError).toBe(false);
    const taskMediaId = finalized.data.media?.id;
    expect(taskMediaId).toBeTruthy();
    expect(finalized.data.linkedTo?.entityType).toBe('task');
    expect(finalized.data.media?.markdownSnippet).toContain(`/api/v1/media/${taskMediaId}`);

    const got = await call<{ task?: ItemWithMedia }>(readToken, 'get_project_task', {
      taskId: 'PRO-T-1',
    });
    expect(got.data.task?.mediaLinkCount).toBe(1);
    expect(got.data.task?.mediaLinks[0]).toMatchObject({
      kind: 'media',
      mediaId: taskMediaId,
      deleted: false,
    });

    const listedTasks = await call<{ tasks?: ItemWithMedia[] }>(
      readToken,
      'list_project_tasks',
      { projectId },
    );
    const listedTask = listedTasks.data.tasks?.find((row) => row.humanKey === 'PRO-T-1');
    expect(listedTask?.mediaLinkCount).toBe(1);
    expect(listedTask?.mediaLinks[0]?.mediaId).toBe(taskMediaId);

    const library = await call<{ media?: { id: string } }>(
      writeToken,
      'upload_workspace_media',
      {
        workspaceId,
        contentBase64: TINY_PNG,
        contentType: 'image/png',
        filename: 'library.png',
        alt: 'Existing library image',
      },
    );
    expect(library.isError).toBe(false);
    const libraryId = library.data.media?.id;
    expect(libraryId).toBeTruthy();
    expect(libraryId).not.toBe(taskMediaId);

    const external = 'https://example.com/story-shot';
    const linked = await call<{ mediaLinks?: MediaLink[] }>(
      writeToken,
      'set_delivery_media_links',
      {
        projectId,
        entityType: 'user_story',
        entityId: 'PRO-S-1',
        links: [
          { kind: 'media', mediaId: libraryId, title: 'Library shot' },
          { kind: 'url', url: external, title: 'External shot' },
        ],
      },
    );
    expect(linked.isError).toBe(false);
    expect(linked.data.mediaLinks?.map((link) => link.kind)).toEqual(['media', 'url']);

    const stories = await call<{ userStories?: ItemWithMedia[] }>(
      readToken,
      'list_project_user_stories',
      { projectId },
    );
    const listedStory = stories.data.userStories?.find((row) => row.humanKey === 'PRO-S-1');
    expect(listedStory?.mediaLinkCount).toBe(2);
    expect(listedStory?.mediaLinks.map((link) => link.title)).toEqual([
      'Library shot',
      'External shot',
    ]);

    const filtered = await call<{ media?: Array<{ id: string }> }>(
      readToken,
      'list_workspace_media',
      { workspaceId, entityType: 'user_story', entityId: 'PRO-S-1' },
    );
    expect(filtered.isError).toBe(false);
    expect(filtered.data.media?.map((row) => row.id)).toEqual([libraryId]);

    const raid = await call<{ raidItem?: { humanKey: string | null } }>(
      writeToken,
      'create_project_raid_item',
      { projectId, kind: 'risk', title: 'Media risk', severity: 'medium' },
    );
    expect(raid.isError).toBe(false);
    const change = await call<{ changeItem?: { humanKey: string | null } }>(
      writeToken,
      'create_project_change_item',
      { projectId, kind: 'scope', title: 'Media change' },
    );
    expect(change.isError).toBe(false);
    const milestone = await call<{ milestone?: { humanKey: string | null } }>(
      writeToken,
      'create_project_milestone',
      { projectId, title: 'Media milestone' },
    );
    expect(milestone.isError).toBe(false);
    const sprint = await call<{ sprint?: { humanKey: string | null } }>(
      writeToken,
      'create_project_sprint',
      { projectId, name: 'Media sprint' },
    );
    expect(sprint.isError).toBe(false);

    for (const target of [
      { entityType: 'epic', entityId: 'PRO-E-1', tool: 'list_project_epics', key: 'epics' },
      {
        entityType: 'raid',
        entityId: raid.data.raidItem?.humanKey,
        tool: 'list_project_raid_items',
        key: 'raidItems',
      },
      {
        entityType: 'change',
        entityId: change.data.changeItem?.humanKey,
        tool: 'list_project_change_items',
        key: 'changeItems',
      },
      {
        entityType: 'milestone',
        entityId: milestone.data.milestone?.humanKey,
        tool: 'list_project_milestones',
        key: 'milestones',
      },
      {
        entityType: 'sprint',
        entityId: sprint.data.sprint?.humanKey,
        tool: 'list_project_sprints',
        key: 'sprints',
      },
    ]) {
      const saved = await call(writeToken, 'set_delivery_media_links', {
        projectId,
        entityType: target.entityType,
        entityId: target.entityId,
        links: [{ kind: 'media', mediaId: libraryId }],
      });
      expect(saved.isError, saved.text).toBe(false);
      const page = await call<Record<string, ItemWithMedia[]>>(readToken, target.tool, {
        projectId,
      });
      const row = page.data[target.key]?.find((item) => item.humanKey === target.entityId);
      expect(row?.mediaLinkCount, target.entityType).toBe(1);
      expect(row?.mediaLinks[0]?.mediaId).toBe(libraryId);
    }

    const unlinked = await call<{ mediaLinks?: MediaLink[] }>(
      writeToken,
      'set_delivery_media_links',
      {
        projectId,
        entityType: 'user_story',
        entityId: story.data.userStory?.id,
        links: [{ kind: 'url', url: external, title: 'External shot' }],
      },
    );
    expect(unlinked.isError).toBe(false);
    expect(unlinked.data.mediaLinks).toHaveLength(1);
    expect(unlinked.data.mediaLinks?.[0]?.kind).toBe('url');

    const stillThere = await call<{ media?: Array<{ id: string }> }>(
      readToken,
      'list_workspace_media',
      { workspaceId },
    );
    const ids = stillThere.data.media?.map((row) => row.id) ?? [];
    expect(ids).toContain(libraryId);
    expect(ids).toContain(taskMediaId);

    const readerWrite = await call(readToken, 'set_delivery_media_links', {
      projectId,
      entityType: 'user_story',
      entityId: 'PRO-S-1',
      links: [],
    });
    expect(readerWrite.isError).toBe(true);
    expect(readerWrite.text).toContain('pm:write');

    const noPm = await call(knowledgeToken, 'begin_workspace_media_upload', {
      workspaceId,
      contentType: 'image/png',
      targetEntityType: 'task',
      targetEntityId: 'PRO-T-1',
    });
    expect(noPm.isError).toBe(true);
    expect(noPm.text).toContain('pm:write');

    const unknown = await call(writeToken, 'set_delivery_media_links', {
      projectId,
      entityType: 'task',
      entityId: 'PRO-T-1',
      links: [],
      notAField: true,
    });
    expect(unknown.isError).toBe(true);
    expect(unknown.text).toContain('notAField');

    const otherTask = await call<{ task?: { id: string; humanKey: string | null } }>(
      bothToken,
      'create_project_task',
      { projectId: otherProjectId, title: 'Other workspace task' },
    );
    expect(otherTask.isError).toBe(false);

    const crossLink = await call(bothToken, 'set_delivery_media_links', {
      projectId: otherProjectId,
      entityType: 'task',
      entityId: otherTask.data.task?.humanKey,
      links: [{ kind: 'media', mediaId: libraryId }],
    });
    expect(crossLink.isError).toBe(true);
    expect(crossLink.text).toMatch(/workspace/i);

    const crossUpload = await call(bothToken, 'begin_workspace_media_upload', {
      workspaceId,
      contentType: 'image/png',
      targetEntityType: 'task',
      targetEntityId: otherTask.data.task?.humanKey,
    });
    expect(crossUpload.isError).toBe(true);
    expect(crossUpload.text).toMatch(/workspace/i);

    const crossList = await call(bothToken, 'list_workspace_media', {
      workspaceId,
      entityType: 'task',
      entityId: otherTask.data.task?.id,
    });
    expect(crossList.isError).toBe(true);
    expect(crossList.text).toMatch(/workspace/i);
  });
});
