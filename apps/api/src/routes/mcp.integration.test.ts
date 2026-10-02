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

describe.skipIf(!hasIntegrationEnv)('MCP (read + draft write)', () => {
  let app: FastifyInstance | undefined;
  let redis: Redis | undefined;
  let closeDatabase: (() => Promise<void>) | undefined;
  let adminCookie = '';
  let organizationId = '';
  let workspaceId = '';
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
    expect(names).toContain('list_record_metadata');
    expect(names).toContain('create_knowledge_record');
    expect(names).toContain('update_knowledge_record');
    expect(names).toContain('upload_workspace_media');
    expect(names).toContain('begin_workspace_media_upload');
    expect(names).toContain('append_workspace_media_upload');
    expect(names).toContain('finalize_workspace_media_upload');
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

  it('lists workspaces with access info', async () => {
    const listWs = await mcpCall(app!, readToken, 4, 'tools/call', {
      name: 'list_workspaces',
      arguments: {},
    });
    expect(listWs.statusCode).toBe(200);
    const body = listWs.json() as {
      result?: { content?: Array<{ text?: string }>; isError?: boolean };
    };
    expect(body.result?.isError).toBeFalsy();
    const data = JSON.parse(body.result?.content?.[0]?.text ?? '{}') as {
      workspaces?: Array<{ id: string; name: string; writeAllowed: boolean }>;
    };
    expect(data.workspaces?.length).toBeGreaterThan(0);
    const ws = data.workspaces?.find((w) => w.id === workspaceId);
    expect(ws).toBeDefined();
    expect(ws?.writeAllowed).toBe(true);
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

  it('creates project via MCP with AI provenance', async () => {
    const pmWrite = await app!.inject({
      method: 'POST',
      url: '/api/v1/api-clients',
      headers: { cookie: adminCookie, origin: 'http://localhost:3100' },
      payload: {
        organizationId,
        name: 'PM write client',
        scopes: [...DEFAULT_MCP_SCOPES, 'pm:write'],
        allowedWorkspaceIds: [workspaceId],
        actingUserId: adminUserId,
      },
    });
    expect(pmWrite.statusCode).toBe(200);
    const pmToken = (pmWrite.json() as { token: string }).token;

    const create = await mcpCall(app!, pmToken, 50, 'tools/call', {
      name: 'create_project',
      arguments: {
        workspaceId,
        name: 'AI Agent Project',
        keyPrefix: 'AGT',
        description: 'Created by AI agent via MCP',
        currency: 'USD',
        methodology: 'scrum',
        generatedByModel: 'test-model-v1',
      },
    });
    expect(create.statusCode).toBe(200);
    const body = create.json() as {
      result?: { isError?: boolean; content?: Array<{ text?: string }> };
    };
    expect(body.result?.isError).toBeFalsy();
    const data = JSON.parse(body.result?.content?.[0]?.text ?? '{}') as {
      project?: {
        id: string;
        name: string;
        keyPrefix: string;
        lifecycleStage: string;
        createdByType: string;
        createdByModel: string;
        url: string;
      };
    };
    expect(data.project?.id).toBeTruthy();
    expect(data.project?.name).toBe('AI Agent Project');
    expect(data.project?.keyPrefix).toBe('AGT');
    expect(data.project?.lifecycleStage).toBe('idea');
    expect(data.project?.createdByType).toBe('api_client');
    expect(data.project?.createdByModel).toBe('test-model-v1');
    expect(data.project?.url).toContain('/projects/');

    const getProj = await mcpCall(app!, pmToken, 51, 'tools/call', {
      name: 'get_project',
      arguments: { projectId: data.project!.id },
    });
    expect(getProj.statusCode).toBe(200);
    const getBody = getProj.json() as {
      result?: { content?: Array<{ text?: string }> };
    };
    const proj = JSON.parse(getBody.result?.content?.[0]?.text ?? '{}') as {
      project?: { lifecycleStage: string; createdByModel: string };
    };
    expect(proj.project?.lifecycleStage).toBe('idea');
    expect(proj.project?.createdByModel).toBe('test-model-v1');
  });

  it('rejects duplicate project name', async () => {
    const pmWrite = await app!.inject({
      method: 'POST',
      url: '/api/v1/api-clients',
      headers: { cookie: adminCookie, origin: 'http://localhost:3100' },
      payload: {
        organizationId,
        name: 'PM write client 2',
        scopes: [...DEFAULT_MCP_SCOPES, 'pm:write'],
        allowedWorkspaceIds: [workspaceId],
        actingUserId: adminUserId,
      },
    });
    const pmToken = (pmWrite.json() as { token: string }).token;

    const dup = await mcpCall(app!, pmToken, 52, 'tools/call', {
      name: 'create_project',
      arguments: {
        workspaceId,
        name: 'MCP Project',
      },
    });
    expect(dup.statusCode).toBe(200);
    const body = dup.json() as {
      result?: { isError?: boolean; content?: Array<{ text?: string }> };
    };
    expect(body.result?.isError).toBe(true);
    expect(body.result?.content?.[0]?.text ?? '').toContain('already exists');
    expect(body.result?.content?.[0]?.text ?? '').toContain('confirm=true');
  });

  it('allows duplicate project with confirm=true', async () => {
    const pmWrite = await app!.inject({
      method: 'POST',
      url: '/api/v1/api-clients',
      headers: { cookie: adminCookie, origin: 'http://localhost:3100' },
      payload: {
        organizationId,
        name: 'PM write client 2b',
        scopes: [...DEFAULT_MCP_SCOPES, 'pm:write'],
        allowedWorkspaceIds: [workspaceId],
        actingUserId: adminUserId,
      },
    });
    const pmToken = (pmWrite.json() as { token: string }).token;

    const create = await mcpCall(app!, pmToken, 525, 'tools/call', {
      name: 'create_project',
      arguments: {
        workspaceId,
        name: 'MCP Project',
        keyPrefix: 'MP2',
        confirm: true,
      },
    });
    if (create.statusCode !== 200) {
      console.error('create_project failed:', create.statusCode, create.body);
    }
    expect(create.statusCode).toBe(200);
    const body = create.json() as {
      result?: { isError?: boolean; content?: Array<{ text?: string }> };
    };
    if (body.result?.isError) {
      console.error('MCP error:', body.result.content?.[0]?.text);
    }
    expect(body.result?.isError).toBeFalsy();
  });

  it('rejects MCP promotion to active', async () => {
    const pmWrite = await app!.inject({
      method: 'POST',
      url: '/api/v1/api-clients',
      headers: { cookie: adminCookie, origin: 'http://localhost:3100' },
      payload: {
        organizationId,
        name: 'PM write client 3',
        scopes: [...DEFAULT_MCP_SCOPES, 'pm:write'],
        allowedWorkspaceIds: [workspaceId],
        actingUserId: adminUserId,
      },
    });
    const pmToken = (pmWrite.json() as { token: string }).token;

    const create = await mcpCall(app!, pmToken, 53, 'tools/call', {
      name: 'create_project',
      arguments: {
        workspaceId,
        name: 'Test Lifecycle Project',
        keyPrefix: 'TLC',
      },
    });
    const createBody = create.json() as {
      result?: { content?: Array<{ text?: string }> };
    };
    const created = JSON.parse(createBody.result?.content?.[0]?.text ?? '{}') as {
      project?: { id: string };
    };
    const projectId = created.project!.id;

    const promoteAttempt = await mcpCall(app!, pmToken, 54, 'tools/call', {
      name: 'update_project',
      arguments: {
        projectId,
        lifecycleStage: 'active',
      },
    });
    expect(promoteAttempt.statusCode).toBe(200);
    const promoteBody = promoteAttempt.json() as {
      result?: { isError?: boolean; content?: Array<{ text?: string }> };
    };
    expect(promoteBody.result?.isError).toBe(true);
    const errorText = promoteBody.result?.content?.[0]?.text ?? '';
    expect(errorText.toLowerCase()).toContain('mcp');
    expect(errorText.toLowerCase()).toContain('human');

    // But can transition between draft stages
    const draftUpdate = await mcpCall(app!, pmToken, 545, 'tools/call', {
      name: 'update_project',
      arguments: {
        projectId,
        lifecycleStage: 'draft',
        description: 'Updated description',
        methodology: 'kanban',
      },
    });
    expect(draftUpdate.statusCode).toBe(200);
    const draftBody = draftUpdate.json() as {
      result?: { isError?: boolean; content?: Array<{ text?: string }> };
    };
    expect(draftBody.result?.isError).toBeFalsy();
    const updated = JSON.parse(draftBody.result?.content?.[0]?.text ?? '{}') as {
      project?: { lifecycleStage: string; description: string };
    };
    expect(updated.project?.lifecycleStage).toBe('draft');
    expect(updated.project?.description).toBe('Updated description');
  });

  it('filters projects by lifecycle stage', async () => {
    const pmWrite = await app!.inject({
      method: 'POST',
      url: '/api/v1/api-clients',
      headers: { cookie: adminCookie, origin: 'http://localhost:3100' },
      payload: {
        organizationId,
        name: 'PM write client 4',
        scopes: [...DEFAULT_MCP_SCOPES, 'pm:write'],
        allowedWorkspaceIds: [workspaceId],
        actingUserId: adminUserId,
      },
    });
    const pmToken = (pmWrite.json() as { token: string }).token;

    const listIdea = await mcpCall(app!, pmToken, 55, 'tools/call', {
      name: 'list_projects',
      arguments: {
        workspaceId,
        lifecycleStage: 'idea',
        limit: 100,
      },
    });
    expect(listIdea.statusCode).toBe(200);
    const body = listIdea.json() as {
      result?: { content?: Array<{ text?: string }> };
    };
    const data = JSON.parse(body.result?.content?.[0]?.text ?? '{}') as {
      projects?: Array<{ lifecycleStage: string; name: string }>;
    };
    expect(data.projects?.some((p) => p.lifecycleStage === 'idea')).toBe(true);
    expect(data.projects?.every((p) => p.lifecycleStage === 'idea')).toBe(true);
  });

  it('returns PROJECT_ARCHIVED (410) for archived projects', async () => {
    // Create and archive a project
    const create = await app!.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { cookie: adminCookie, origin: 'http://localhost:3100' },
      payload: { workspaceId, name: 'To Archive', keyPrefix: 'ARC' },
    });
    const projectId = (create.json() as { project: { id: string } }).project.id;

    await app!.inject({
      method: 'PATCH',
      url: `/api/v1/projects/${projectId}`,
      headers: { cookie: adminCookie, origin: 'http://localhost:3100' },
      payload: { archived: true },
    });

    const response = await mcpCall(app!, readToken, 60, 'tools/call', {
      name: 'get_project',
      arguments: { projectId },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      result?: { isError?: boolean; content?: Array<{ text?: string }> };
    };
    expect(body.result?.isError).toBe(true);
    const errorText = body.result?.content?.[0]?.text ?? '';
    expect(errorText.toLowerCase()).toContain('archived');
  });

  it('returns PROJECT_NOT_FOUND (404) for non-existent projects', async () => {
    const response = await mcpCall(app!, readToken, 61, 'tools/call', {
      name: 'get_project',
      arguments: { projectId: '00000000-0000-0000-0000-000000000000' },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      result?: { isError?: boolean; content?: Array<{ text?: string }> };
    };
    expect(body.result?.isError).toBe(true);
    const errorText = body.result?.content?.[0]?.text ?? '';
    expect(errorText.toLowerCase()).toContain('not found');
  });

  it('returns workspace not allowed error with workspaceId', async () => {
    // Use writeToken which has knowledge:write scope but otherWorkspaceId is not in allowlist
    const record = await mcpCall(app!, writeToken, 62, 'tools/call', {
      name: 'create_knowledge_record',
      arguments: {
        workspaceId: otherWorkspaceId,
        title: 'Should fail',
        recordType: 'runbook',
        contentMarkdown: '# Fail\n',
      },
    });
    expect(record.statusCode).toBe(200);
    const body = record.json() as {
      result?: { isError?: boolean; content?: Array<{ text?: string }> };
    };
    expect(body.result?.isError).toBe(true);
    const text = body.result?.content?.[0]?.text ?? '';
    expect(text.toLowerCase()).toContain('workspace');
    expect(text.toLowerCase()).toContain('not allowed');
  });
});
