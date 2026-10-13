import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import { hashPassword } from '@project-knowledge-hub/auth';
import { loadEnv } from '@project-knowledge-hub/config';
import {
  createDatabase,
  organizations,
  users,
  workspaces,
} from '@project-knowledge-hub/database';
import { DEFAULT_MCP_SCOPES, MCP_CONTENT_TRUNCATION_SUFFIX } from '@project-knowledge-hub/mcp';
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
  method: string,
  params: Record<string, unknown>,
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
      method,
      params,
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

describe.skipIf(!hasIntegrationEnv)('MCP (read + draft write)', () => {
  let app: FastifyInstance | undefined;
  let redis: Redis | undefined;
  let closeDatabase: (() => Promise<void>) | undefined;
  let adminCookie = '';
  let organizationId = '';
  let workspaceId = '';
  let workspaceName = '';
  let workspaceSlug = '';
  let otherWorkspaceId = '';
  let adminUserId = '';
  let readToken = '';
  let writeToken = '';
  const password = 'test-password-123';

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
    if (!org) {
      throw new Error('org missing');
    }
    organizationId = org.id;

    const [admin] = await database.db
      .insert(users)
      .values({
        email: `admin-m6-${suffix}@example.com`,
        displayName: 'Admin',
        passwordHash: await hashPassword(password),
        isSystemAdmin: true,
        status: 'active',
      })
      .returning();
    if (!admin) {
      throw new Error('admin missing');
    }
    adminUserId = admin.id;

    const [workspace] = await database.db
      .insert(workspaces)
      .values({
        organizationId: org.id,
        name: `WS ${suffix}`,
        slug: `ws-${suffix}`,
      })
      .returning();
    if (!workspace) {
      throw new Error('workspace missing');
    }
    workspaceId = workspace.id;
    workspaceName = workspace.name;
    workspaceSlug = workspace.slug;

    const [otherWorkspace] = await database.db
      .insert(workspaces)
      .values({
        organizationId: org.id,
        name: `WS other ${suffix}`,
        slug: `ws-other-${suffix}`,
      })
      .returning();
    if (!otherWorkspace) {
      throw new Error('other workspace missing');
    }
    otherWorkspaceId = otherWorkspace.id;

    app = await buildApp({ env, database, redis });
    await app.ready();

    const adminLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: admin.email, password },
    });
    adminCookie = `${env.SESSION_COOKIE_NAME}=${adminLogin.cookies.find((c) => c.name === env.SESSION_COOKIE_NAME)?.value}`;

    const readClient = await app.inject({
      method: 'POST',
      url: '/api/v1/api-clients',
      headers: { cookie: adminCookie, origin: 'http://localhost:3100' },
      payload: {
        organizationId,
        name: 'MCP read client',
        allowedWorkspaceIds: [workspaceId],
      },
    });
    expect(readClient.statusCode).toBe(200);
    readToken = (readClient.json() as { token: string }).token;

    const writeClient = await app.inject({
      method: 'POST',
      url: '/api/v1/api-clients',
      headers: { cookie: adminCookie, origin: 'http://localhost:3100' },
      payload: {
        organizationId,
        name: 'MCP write client',
        scopes: [...DEFAULT_MCP_SCOPES, 'knowledge:write'],
        allowedWorkspaceIds: [workspaceId],
        actingUserId: adminUserId,
      },
    });
    expect(writeClient.statusCode).toBe(200);
    writeToken = (writeClient.json() as { token: string }).token;

    await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { cookie: adminCookie, origin: 'http://localhost:3100' },
      payload: { workspaceId, name: 'MCP Project', status: 'active' },
    });

    await app.inject({
      method: 'POST',
      url: '/api/v1/knowledge-records',
      headers: { cookie: adminCookie, origin: 'http://localhost:3100' },
      payload: {
        workspaceId,
        title: 'MCP Bridge Config',
        recordType: 'configuration',
        lifecycleStatus: 'verified',
        contentMarkdown: '# Bridge\n\nCurrent Tailscale Headscale bridge settings.\n',
      },
    });
  });

  afterAll(async () => {
    // @hono/node-server drains unread POST bodies on a 500ms timer. Let that
    // timer run while Vitest is still inside this hook.
    await new Promise((resolve) => {
      setTimeout(resolve, 600);
    });
    if (app) {
      await app.close();
    }
    if (redis) {
      try {
        await redis.quit();
      } catch {
        redis.disconnect();
      }
    }
    if (closeDatabase) {
      await closeDatabase();
    }
  });

  it('rejects MCP without bearer token', async () => {
    const response = await app!.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
      },
      payload: {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test', version: '1.0.0' },
        },
      },
    });
    expect(response.statusCode).toBe(401);
    expect(response.headers['www-authenticate']).toBeUndefined();
  });

  it('lists tools and searches knowledge via MCP', async () => {
    const init = await mcpCall(app!, readToken, 1, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test', version: '1.0.0' },
    });
    expect(init.statusCode).toBe(200);
    const initBody = init.json() as {
      result?: { serverInfo?: { name?: string } };
    };
    expect(initBody.result?.serverInfo?.name).toBe('project-knowledge-hub');

    const tools = await mcpCall(app!, readToken, 2, 'tools/list', {});
    expect(tools.statusCode).toBe(200);
    const toolsBody = tools.json() as {
      result?: { tools?: Array<{ name: string }> };
    };
    const names = (toolsBody.result?.tools ?? []).map((tool) => tool.name);
    expect(names).toContain('search_knowledge');
    expect(names).toContain('list_projects');
    expect(names).toContain('list_workspaces');
    expect(names).toContain('list_record_metadata');
    expect(names).toContain('create_knowledge_record');
    expect(names).toContain('update_knowledge_record');
    expect(names).toContain('upload_workspace_media');
    expect(names).toContain('begin_workspace_media_upload');
    expect(names).toContain('append_workspace_media_upload');
    expect(names).toContain('finalize_workspace_media_upload');
    expect(names).toContain('begin_record_content_upload');
    expect(names).toContain('append_record_content');
    expect(names).toContain('finalize_record_content_upload');
    expect(names).toContain('list_workspace_media');

    const search = await mcpCall(app!, readToken, 3, 'tools/call', {
      name: 'search_knowledge',
      arguments: {
        workspaceId,
        query: 'Bridge',
        limit: 5,
      },
    });
    expect(search.statusCode).toBe(200);
    const searchBody = search.json() as {
      result?: { content?: Array<{ text?: string }>; isError?: boolean };
    };
    expect(searchBody.result?.isError).toBeFalsy();
    const text = searchBody.result?.content?.[0]?.text ?? '';
    expect(text.toLowerCase()).toContain('bridge');
  });

  it('returns workspace names and resolves a project by slug', async () => {
    const created = await app!.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { cookie: adminCookie, origin: 'http://localhost:3100' },
      payload: {
        workspaceId,
        name: 'Path Project',
        slug: 'path-project',
      },
    });
    expect(created.statusCode).toBe(200);

    const workspacesCall = await mcpCall(app!, readToken, 4, 'tools/call', {
      name: 'list_workspaces',
      arguments: {},
    });
    const workspacesBody = workspacesCall.json() as {
      result?: { isError?: boolean; content?: Array<{ text?: string }> };
    };
    expect(workspacesBody.result?.isError).toBeFalsy();
    const workspaceList = JSON.parse(
      workspacesBody.result?.content?.[0]?.text ?? '{}',
    ) as { workspaces?: Array<{ id: string; name: string; slug: string }> };
    expect(workspaceList.workspaces).toEqual([
      { id: workspaceId, name: workspaceName, slug: workspaceSlug },
    ]);

    const projectsCall = await mcpCall(app!, readToken, 5, 'tools/call', {
      name: 'list_projects',
      arguments: { workspaceSlug, limit: 25 },
    });
    const projectsBody = projectsCall.json() as {
      result?: { isError?: boolean; content?: Array<{ text?: string }> };
    };
    expect(projectsBody.result?.isError).toBeFalsy();
    const projectList = JSON.parse(
      projectsBody.result?.content?.[0]?.text ?? '{}',
    ) as {
      projects?: Array<{
        slug: string;
        workspaceName: string | null;
        workspaceSlug: string | null;
      }>;
    };
    expect(projectList.projects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slug: 'path-project',
          workspaceName,
          workspaceSlug,
        }),
      ]),
    );

    const projectCall = await mcpCall(app!, readToken, 6, 'tools/call', {
      name: 'get_project',
      arguments: { projectSlug: 'path-project', workspaceSlug },
    });
    const projectBody = projectCall.json() as {
      result?: { isError?: boolean; content?: Array<{ text?: string }> };
    };
    expect(projectBody.result?.isError).toBeFalsy();
    const detail = JSON.parse(projectBody.result?.content?.[0]?.text ?? '{}') as {
      project?: { slug: string; workspaceName: string | null; workspaceSlug: string | null };
    };
    expect(detail.project).toEqual(
      expect.objectContaining({
        slug: 'path-project',
        workspaceName,
        workspaceSlug,
      }),
    );
  });

  it('denies create without knowledge:write scope', async () => {
    const response = await mcpCall(app!, readToken, 10, 'tools/call', {
      name: 'create_knowledge_record',
      arguments: {
        workspaceId,
        title: 'Should fail',
        recordType: 'runbook',
        contentMarkdown: '# Nope\n',
      },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      result?: { isError?: boolean; content?: Array<{ text?: string }> };
    };
    expect(body.result?.isError).toBe(true);
    expect(body.result?.content?.[0]?.text ?? '').toContain('knowledge:write');
  });

  it('rejects write client create without actingUserId / allowlist', async () => {
    const missingActing = await app!.inject({
      method: 'POST',
      url: '/api/v1/api-clients',
      headers: { cookie: adminCookie, origin: 'http://localhost:3100' },
      payload: {
        organizationId,
        name: 'bad write client',
        scopes: [...DEFAULT_MCP_SCOPES, 'knowledge:write'],
        allowedWorkspaceIds: [workspaceId],
      },
    });
    expect(missingActing.statusCode).toBe(400);

    const missingAllowlist = await app!.inject({
      method: 'POST',
      url: '/api/v1/api-clients',
      headers: { cookie: adminCookie, origin: 'http://localhost:3100' },
      payload: {
        organizationId,
        name: 'bad write client 2',
        scopes: [...DEFAULT_MCP_SCOPES, 'knowledge:write'],
        actingUserId: adminUserId,
        allowedWorkspaceIds: [],
      },
    });
    expect(missingAllowlist.statusCode).toBe(400);
  });

  it('creates and updates draft knowledge via write MCP tools', async () => {
    const create = await mcpCall(app!, writeToken, 20, 'tools/call', {
      name: 'create_knowledge_record',
      arguments: {
        workspaceId,
        title: 'Agent Draft Runbook',
        recordType: 'runbook',
        contentMarkdown: '# Agent draft\n\nSteps here.\n',
        summary: 'Created by MCP test',
        tags: ['Runbook', 'Ops'],
        generatedByModel: 'test-model',
      },
    });
    expect(create.statusCode).toBe(200);
    const createBody = create.json() as {
      result?: { isError?: boolean; content?: Array<{ text?: string }> };
    };
    expect(createBody.result?.isError).toBeFalsy();
    const created = JSON.parse(createBody.result?.content?.[0]?.text ?? '{}') as {
      knowledgeRecord?: {
        id: string;
        lifecycleStatus: string;
        sourceOfTruthMode: string;
      };
    };
    expect(created.knowledgeRecord?.lifecycleStatus).toBe('draft');
    expect(created.knowledgeRecord?.sourceOfTruthMode).toBe('ai_generated_draft');
    const recordId = created.knowledgeRecord?.id;
    expect(recordId).toBeTruthy();

    const update = await mcpCall(app!, writeToken, 21, 'tools/call', {
      name: 'update_knowledge_record',
      arguments: {
        recordId,
        changeMessage: 'Clarify steps',
        contentMarkdown: '# Agent draft\n\nUpdated steps.\n',
      },
    });
    expect(update.statusCode).toBe(200);
    const updateBody = update.json() as {
      result?: { isError?: boolean; content?: Array<{ text?: string }> };
    };
    expect(updateBody.result?.isError).toBeFalsy();
    const updated = JSON.parse(updateBody.result?.content?.[0]?.text ?? '{}') as {
      knowledgeRecord?: { lifecycleStatus: string; versioned?: boolean };
    };
    expect(updated.knowledgeRecord?.lifecycleStatus).toBe('draft');
    expect(updated.knowledgeRecord?.versioned).toBe(true);

    const getRecord = await mcpCall(app!, writeToken, 22, 'tools/call', {
      name: 'get_knowledge_record',
      arguments: { recordId },
    });
    expect(getRecord.statusCode).toBe(200);
    const getRecordBody = getRecord.json() as {
      result?: { isError?: boolean; content?: Array<{ text?: string }> };
    };
    expect(getRecordBody.result?.isError).toBeFalsy();
    const detail = JSON.parse(getRecordBody.result?.content?.[0]?.text ?? '{}') as {
      knowledgeRecord?: { tags?: string[] };
    };
    expect(detail.knowledgeRecord?.tags).toEqual(['Ops', 'Runbook']);

    const listed = await mcpCall(app!, writeToken, 23, 'tools/call', {
      name: 'list_knowledge_records',
      arguments: { workspaceId, limit: 25 },
    });
    expect(listed.statusCode).toBe(200);
    const listedBody = listed.json() as {
      result?: { isError?: boolean; content?: Array<{ text?: string }> };
    };
    expect(listedBody.result?.isError).toBeFalsy();
    const list = JSON.parse(listedBody.result?.content?.[0]?.text ?? '{}') as {
      knowledgeRecords?: Array<{ id: string; tags?: string[] }>;
    };
    expect(list.knowledgeRecords?.find((row) => row.id === recordId)?.tags).toEqual([
      'Ops',
      'Runbook',
    ]);
  });

  it('denies write to a workspace outside the allowlist', async () => {
    const create = await mcpCall(app!, writeToken, 30, 'tools/call', {
      name: 'create_knowledge_record',
      arguments: {
        workspaceId: otherWorkspaceId,
        title: 'Outside allowlist',
        recordType: 'overview',
        contentMarkdown: '# Outside\n',
      },
    });
    expect(create.statusCode).toBe(200);
    const body = create.json() as {
      result?: { isError?: boolean; content?: Array<{ text?: string }> };
    };
    expect(body.result?.isError).toBe(true);
    expect(body.result?.content?.[0]?.text ?? '').toMatch(/not allowed|Workspace/i);
  });

  it('uploads workspace media and can insert markdown into a record', async () => {
    const create = await mcpCall(app!, writeToken, 40, 'tools/call', {
      name: 'create_knowledge_record',
      arguments: {
        workspaceId,
        title: 'Media embed draft',
        recordType: 'note',
        contentMarkdown: '# Chart draft\n',
      },
    });
    expect(create.statusCode).toBe(200);
    const createBody = create.json() as {
      result?: { isError?: boolean; content?: Array<{ text?: string }> };
    };
    expect(createBody.result?.isError).toBeFalsy();
    const created = JSON.parse(createBody.result?.content?.[0]?.text ?? '{}') as {
      knowledgeRecord?: { id: string };
    };
    const recordId = created.knowledgeRecord?.id;
    expect(recordId).toBeTruthy();

    // 1x1 PNG
    const pngBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

    const upload = await mcpCall(app!, writeToken, 41, 'tools/call', {
      name: 'upload_workspace_media',
      arguments: {
        workspaceId,
        contentBase64: pngBase64,
        contentType: 'image/png',
        filename: 'pixel.png',
        alt: 'Tiny chart',
        knowledgeRecordId: recordId,
        insertIntoRecord: true,
      },
    });
    expect(upload.statusCode).toBe(200);
    const uploadBody = upload.json() as {
      result?: { isError?: boolean; content?: Array<{ text?: string }> };
    };
    expect(uploadBody.result?.isError).toBeFalsy();
    const uploaded = JSON.parse(uploadBody.result?.content?.[0]?.text ?? '{}') as {
      media?: { id: string; markdownSnippet: string; url: string };
      insertedIntoRecord?: boolean;
    };
    expect(uploaded.media?.id).toBeTruthy();
    expect(uploaded.media?.markdownSnippet).toContain('/api/v1/media/');
    expect(uploaded.insertedIntoRecord).toBe(true);

    const get = await mcpCall(app!, writeToken, 42, 'tools/call', {
      name: 'get_knowledge_record',
      arguments: { recordId },
    });
    expect(get.statusCode).toBe(200);
    const getBody = get.json() as {
      result?: { isError?: boolean; content?: Array<{ text?: string }> };
    };
    expect(getBody.result?.isError).toBeFalsy();
    const detail = JSON.parse(getBody.result?.content?.[0]?.text ?? '{}') as {
      knowledgeRecord?: {
        contentMarkdown: string;
        media?: Array<{ id: string; markdownSnippet: string }>;
      };
    };
    expect(detail.knowledgeRecord?.contentMarkdown).toContain(uploaded.media!.url);
    expect(detail.knowledgeRecord?.media?.some((m) => m.id === uploaded.media!.id)).toBe(
      true,
    );
  });

  it('pages a knowledge record, writes it in chunks, and pages a task list', async () => {
    const source = 'alpha beta gamma delta epsilon zeta '.repeat(4);
    const create = await mcpCall(app!, writeToken, 50, 'tools/call', {
      name: 'create_knowledge_record',
      arguments: {
        workspaceId,
        title: 'Paged record',
        recordType: 'runbook',
        contentMarkdown: source,
        tags: ['Paging'],
      },
    });
    const created = toolPayload<{
      knowledgeRecord?: { id: string; currentVersionNumber: number };
    }>(create);
    expect(created.isError).toBe(false);
    const recordId = created.data.knowledgeRecord?.id;
    expect(recordId).toBeTruthy();
    const versionBefore = created.data.knowledgeRecord?.currentVersionNumber;

    let offset = 0;
    let joined = '';
    let pageCount = 0;
    while (pageCount < 20) {
      const read = await mcpCall(app!, writeToken, 51 + pageCount, 'tools/call', {
        name: 'get_knowledge_record',
        arguments: { recordId, contentOffset: offset, contentLimit: 20 },
      });
      const page = toolPayload<{
        knowledgeRecord?: {
          contentMarkdown: string;
          contentTruncated: boolean;
          contentLength: number;
          contentOffset: number;
          nextOffset: number | null;
          returnedChars: number;
          contentSha256: string;
          tags?: string[];
        };
      }>(read);
      expect(page.isError).toBe(false);
      const record = page.data.knowledgeRecord;
      expect(record).toBeTruthy();
      expect(record?.contentLength).toBe(source.length);
      expect(record?.contentSha256).toMatch(/^[a-f0-9]{64}$/);
      if (pageCount === 0) {
        expect(record?.contentOffset).toBe(0);
        expect(record?.contentTruncated).toBe(true);
        expect(record?.contentMarkdown.endsWith(MCP_CONTENT_TRUNCATION_SUFFIX)).toBe(true);
        expect(record?.tags).toEqual(['Paging']);
      } else {
        expect(record?.contentMarkdown.endsWith(MCP_CONTENT_TRUNCATION_SUFFIX)).toBe(false);
        expect(record?.tags).toBeUndefined();
      }
      joined += source.slice(
        record!.contentOffset,
        record!.contentOffset + record!.returnedChars,
      );
      pageCount += 1;
      if (record?.nextOffset == null) break;
      expect(record.nextOffset).toBeGreaterThan(offset);
      offset = record.nextOffset;
    }
    expect(joined).toBe(source);
    expect(pageCount).toBeGreaterThan(1);

    const stale = await mcpCall(app!, writeToken, 80, 'tools/call', {
      name: 'get_knowledge_record',
      arguments: { recordId, expectSha256: 'ab'.repeat(32) },
    });
    const staleBody = toolPayload(stale);
    expect(staleBody.isError).toBe(true);
    expect(staleBody.text).toContain('contentSha256');

    const rejected = await mcpCall(app!, writeToken, 81, 'tools/call', {
      name: 'update_knowledge_record',
      arguments: {
        recordId,
        changeMessage: 'Should fail',
        contentMarkdown: `short${MCP_CONTENT_TRUNCATION_SUFFIX}`,
      },
    });
    const rejectedBody = toolPayload(rejected);
    expect(rejectedBody.isError).toBe(true);
    expect(rejectedBody.text).toContain('truncat');

    const begun = await mcpCall(app!, writeToken, 82, 'tools/call', {
      name: 'begin_record_content_upload',
      arguments: { recordId },
    });
    const session = toolPayload<{
      uploadId?: string;
      maxChunkChars?: number;
      contentSha256?: string;
    }>(begun);
    expect(session.isError).toBe(false);
    expect(session.data.maxChunkChars).toBe(40_000);
    const uploadId = session.data.uploadId;
    expect(uploadId).toBeTruthy();

    const appended = await mcpCall(app!, writeToken, 83, 'tools/call', {
      name: 'append_record_content',
      arguments: { uploadId, chunk: 'Hello ', index: 0 },
    });
    expect(toolPayload(appended).isError).toBe(false);
    const appendedNext = await mcpCall(app!, writeToken, 84, 'tools/call', {
      name: 'append_record_content',
      arguments: { uploadId, chunk: 'chunked', index: 1 },
    });
    expect(toolPayload(appendedNext).isError).toBe(false);

    const finalized = await mcpCall(app!, writeToken, 85, 'tools/call', {
      name: 'finalize_record_content_upload',
      arguments: {
        uploadId,
        changeMessage: 'Replace from chunks',
        expectedLength: 'Hello chunked'.length,
      },
    });
    const saved = toolPayload<{
      knowledgeRecord?: { currentVersionNumber: number };
    }>(finalized);
    expect(saved.isError).toBe(false);
    expect(saved.data.knowledgeRecord?.currentVersionNumber).toBe((versionBefore ?? 1) + 1);

    const reread = await mcpCall(app!, writeToken, 86, 'tools/call', {
      name: 'get_knowledge_record',
      arguments: { recordId },
    });
    const full = toolPayload<{
      knowledgeRecord?: {
        contentMarkdown: string;
        contentTruncated: boolean;
        nextOffset: number | null;
        tags?: string[];
      };
    }>(reread);
    expect(full.isError).toBe(false);
    expect(full.data.knowledgeRecord?.contentMarkdown).toBe('Hello chunked');
    expect(full.data.knowledgeRecord?.contentTruncated).toBe(false);
    expect(full.data.knowledgeRecord?.nextOffset).toBeNull();
    expect(full.data.knowledgeRecord?.tags).toEqual(['Paging']);

    const project = await app!.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { cookie: adminCookie, origin: 'http://localhost:3100' },
      payload: { workspaceId, name: `Paged tasks ${randomUUID()}`, status: 'active' },
    });
    expect(project.statusCode).toBe(200);
    const projectId = (project.json() as { project: { id: string } }).project.id;
    const longDescription = 'D'.repeat(250);
    for (const title of ['One', 'Two', 'Three']) {
      const task = await app!.inject({
        method: 'POST',
        url: `/api/v1/projects/${projectId}/tasks`,
        headers: { cookie: adminCookie, origin: 'http://localhost:3100' },
        payload: { title, description: longDescription, status: 'todo' },
      });
      expect(task.statusCode).toBe(200);
    }

    const pmClient = await app!.inject({
      method: 'POST',
      url: '/api/v1/api-clients',
      headers: { cookie: adminCookie, origin: 'http://localhost:3100' },
      payload: {
        organizationId,
        name: 'MCP pm client',
        scopes: [...DEFAULT_MCP_SCOPES, 'pm:read'],
        allowedWorkspaceIds: [workspaceId],
      },
    });
    expect(pmClient.statusCode).toBe(200);
    const pmToken = (pmClient.json() as { token: string }).token;

    const firstList = await mcpCall(app!, pmToken, 90, 'tools/call', {
      name: 'list_project_tasks',
      arguments: { projectId, limit: 2 },
    });
    const firstPage = toolPayload<{
      tasks?: Array<{ id: string; description: string | null }>;
      total?: number;
      limit?: number;
      hasMore?: boolean;
      nextCursor?: string | null;
    }>(firstList);
    expect(firstPage.isError).toBe(false);
    expect(firstPage.data.total).toBe(3);
    expect(firstPage.data.limit).toBe(2);
    expect(firstPage.data.hasMore).toBe(true);
    expect(firstPage.data.tasks).toHaveLength(2);
    expect(firstPage.data.tasks?.[0]?.description).toBe(`${'D'.repeat(200)}…`);
    const taskId = firstPage.data.tasks?.[0]?.id;
    expect(taskId).toBeTruthy();

    const secondList = await mcpCall(app!, pmToken, 91, 'tools/call', {
      name: 'list_project_tasks',
      arguments: { projectId, limit: 2, cursor: firstPage.data.nextCursor },
    });
    const secondPage = toolPayload<{
      tasks?: Array<{ id: string }>;
      hasMore?: boolean;
      nextCursor?: string | null;
    }>(secondList);
    expect(secondPage.isError).toBe(false);
    expect(secondPage.data.tasks).toHaveLength(1);
    expect(secondPage.data.hasMore).toBe(false);
    expect(secondPage.data.nextCursor).toBeNull();

    const detail = await mcpCall(app!, pmToken, 92, 'tools/call', {
      name: 'get_project_task',
      arguments: { taskId },
    });
    const task = toolPayload<{ task?: { description: string | null } }>(detail);
    expect(task.isError).toBe(false);
    expect(task.data.task?.description).toBe(longDescription);
  });
});
