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

const hasIntegrationEnv = Boolean(process.env.DATABASE_URL) && Boolean(process.env.REDIS_URL);

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

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

function pngUpload(filename: string): { body: Buffer; contentType: string } {
  const boundary = '----khmedia';
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: image/png\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    body: Buffer.concat([head, TINY_PNG, tail]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

type ToolContent = {
  type?: string;
  text?: string;
  data?: string;
  mimeType?: string;
};

function toolResult(response: { json: () => unknown }) {
  const body = response.json() as {
    result?: {
      isError?: boolean;
      content?: ToolContent[];
    };
  };
  const text = body.result?.content?.find((block) => block.type === 'text')?.text ?? '';
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(text) as Record<string, unknown>;
  } catch {
    data = {};
  }
  return {
    isError: Boolean(body.result?.isError),
    text,
    data,
    content: body.result?.content ?? [],
  };
}

describe.skipIf(!hasIntegrationEnv)('MCP get_workspace_media', () => {
  let app: FastifyInstance | undefined;
  let redis: Redis | undefined;
  let closeDatabase: (() => Promise<void>) | undefined;
  let adminCookie = '';
  let workspaceId = '';
  let otherWorkspaceId = '';
  let foreignWorkspaceId = '';
  let projectId = '';
  let readToken = '';
  let otherWorkspaceToken = '';
  let foreignOrgToken = '';
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
    const [foreignOrg] = await database.db
      .insert(organizations)
      .values({ name: `Foreign ${suffix}`, slug: `foreign-${suffix}` })
      .returning();
    const [admin] = await database.db
      .insert(users)
      .values({
        email: `admin-media-read-${suffix}@example.com`,
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
        name: `Other ${suffix}`,
        slug: `other-${suffix}`,
      })
      .returning();
    const [foreign] = await database.db
      .insert(workspaces)
      .values({
        organizationId: foreignOrg?.id ?? '',
        name: `Foreign WS ${suffix}`,
        slug: `foreign-ws-${suffix}`,
      })
      .returning();
    workspaceId = workspace?.id ?? '';
    otherWorkspaceId = other?.id ?? '';
    foreignWorkspaceId = foreign?.id ?? '';
    await database.db.insert(memberships).values({
      userId: admin?.id ?? '',
      workspaceId,
      role: 'workspace_admin',
    });

    app = await buildApp({ env, database, redis });
    await app.ready();

    const adminLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: admin?.email, password },
    });
    adminCookie = `${env.SESSION_COOKIE_NAME}=${
      adminLogin.cookies.find((cookie) => cookie.name === env.SESSION_COOKIE_NAME)?.value
    }`;

    async function clientToken(
      name: string,
      organizationId: string,
      allowedWorkspaceIds: string[],
    ): Promise<string> {
      const created = await app!.inject({
        method: 'POST',
        url: '/api/v1/api-clients',
        headers: { cookie: adminCookie, origin },
        payload: {
          organizationId,
          name,
          scopes: [...DEFAULT_MCP_SCOPES, 'pm:read'],
          allowedWorkspaceIds,
        },
      });
      expect(created.statusCode).toBe(200);
      return (created.json() as { token: string }).token;
    }

    readToken = await clientToken(`reader-${suffix}`, org?.id ?? '', [workspaceId]);
    otherWorkspaceToken = await clientToken(`other-${suffix}`, org?.id ?? '', [otherWorkspaceId]);
    foreignOrgToken = await clientToken(`foreign-${suffix}`, foreignOrg?.id ?? '', [
      foreignWorkspaceId,
    ]);

    const project = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { cookie: adminCookie, origin },
      payload: { workspaceId, name: 'Media read', status: 'active', keyPrefix: 'MRD' },
    });
    expect(project.statusCode).toBe(200);
    projectId = (project.json() as { project: { id: string } }).project.id;
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

  async function call(token: string, name: string, args: Record<string, unknown>) {
    callId += 1;
    const response = await app!.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
      },
      payload: {
        jsonrpc: '2.0',
        id: callId,
        method: 'tools/call',
        params: { name, arguments: args },
      },
    });
    expect(response.statusCode).toBe(200);
    return toolResult(response);
  }

  it('returns image content, a bound signed URL, and forbids other workspaces and orgs', async () => {
    const file = pngUpload('dot.png');
    const uploaded = await app!.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${workspaceId}/media`,
      headers: { cookie: adminCookie, origin, 'content-type': file.contentType },
      payload: file.body,
    });
    expect(uploaded.statusCode).toBe(200);
    const mediaId = (uploaded.json() as { media: { id: string } }).media.id;

    const task = await app!.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/tasks`,
      headers: { cookie: adminCookie, origin },
      payload: { title: 'Read the shot' },
    });
    expect(task.statusCode).toBe(200);
    const taskId = (task.json() as { task: { id: string } }).task.id;
    const linked = await app!.inject({
      method: 'PUT',
      url: `/api/v1/projects/${projectId}/item-media-links`,
      headers: { cookie: adminCookie, origin },
      payload: { entityType: 'task', entityId: taskId, links: [{ kind: 'media', mediaId }] },
    });
    expect(linked.statusCode).toBe(200);

    const read = await call(readToken, 'get_workspace_media', { mediaId });
    expect(read.isError).toBe(false);
    const image = read.content.find((block) => block.type === 'image');
    expect(image?.mimeType).toBe('image/png');
    expect(image?.data).toBe(TINY_PNG.toString('base64'));
    const media = read.data.media as { mediaId?: string; resized?: boolean; hint?: string };
    expect(media.mediaId).toBe(mediaId);
    expect(media.resized).toBe(false);
    expect(media.hint).toMatch(/get_workspace_media/);
    expect(read.text).not.toContain(image?.data ?? 'missing');

    const signedUrl = String(read.data.signedUrl ?? '');
    const expiresAt = Date.parse(String(read.data.expiresAt ?? ''));
    expect(signedUrl).toContain(`/api/v1/media/${mediaId}`);
    expect(expiresAt - Date.now()).toBeGreaterThan(5 * 60 * 1000);
    expect(expiresAt - Date.now()).toBeLessThanOrEqual(15 * 60 * 1000);
    const signed = new URL(signedUrl);
    const fetched = await app!.inject({
      method: 'GET',
      url: `${signed.pathname}${signed.search}`,
    });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.headers['content-type']).toContain('image/png');

    const unsigned = await app!.inject({ method: 'GET', url: `/api/v1/media/${mediaId}` });
    expect(unsigned.statusCode).toBe(401);

    const listed = await call(readToken, 'list_workspace_media', { workspaceId });
    expect(listed.isError).toBe(false);
    const rows = listed.data.media as Array<{ mediaId?: string; hint?: string }>;
    const listedRow = rows.find((row) => row.mediaId === mediaId);
    expect(listedRow?.hint).toMatch(/get_workspace_media/);

    const got = await call(readToken, 'get_project_task', { taskId });
    expect(got.isError).toBe(false);
    const taskBody = got.data.task as {
      mediaLinks?: Array<{ mediaId?: string | null; hint?: string | null }>;
    };
    expect(taskBody.mediaLinks?.[0]?.mediaId).toBe(mediaId);
    expect(taskBody.mediaLinks?.[0]?.hint).toMatch(/get_workspace_media/);

    const otherWorkspace = await call(otherWorkspaceToken, 'get_workspace_media', { mediaId });
    expect(otherWorkspace.isError).toBe(true);
    expect(otherWorkspace.text).toMatch(/do not have access/);

    const foreignOrg = await call(foreignOrgToken, 'get_workspace_media', { mediaId });
    expect(foreignOrg.isError).toBe(true);
    expect(foreignOrg.text).toMatch(/do not have access/);
  });
});
