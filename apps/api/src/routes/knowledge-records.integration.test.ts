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

describe.skipIf(!hasIntegrationEnv)('Knowledge records', () => {
  let app: FastifyInstance | undefined;
  let redis: Redis | undefined;
  let closeDatabase: (() => Promise<void>) | undefined;
  let adminCookie = '';
  let readerCookie = '';
  let workspaceId = '';
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

    const [admin] = await database.db
      .insert(users)
      .values({
        email: `admin-m3-${suffix}@example.com`,
        displayName: 'Admin',
        passwordHash: await hashPassword(password),
        isSystemAdmin: true,
        status: 'active',
      })
      .returning();
    const [reader] = await database.db
      .insert(users)
      .values({
        email: `reader-m3-${suffix}@example.com`,
        displayName: 'Reader',
        passwordHash: await hashPassword(password),
        isSystemAdmin: false,
        status: 'active',
      })
      .returning();
    if (!admin || !reader) {
      throw new Error('users missing');
    }

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

    await database.db.insert(memberships).values({
      userId: reader.id,
      workspaceId: workspace.id,
      role: 'reader',
    });

    app = await buildApp({ env, database, redis });
    await app.ready();

    const adminLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: admin.email, password },
    });
    adminCookie = `${env.SESSION_COOKIE_NAME}=${adminLogin.cookies.find((c) => c.name === env.SESSION_COOKIE_NAME)?.value}`;

    const readerLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: reader.email, password },
    });
    readerCookie = `${env.SESSION_COOKIE_NAME}=${readerLogin.cookies.find((c) => c.name === env.SESSION_COOKIE_NAME)?.value}`;
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

  it('creates a deployment guide linked to a system with safe HTML', async () => {
    const systemResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/systems',
      headers: { cookie: adminCookie, origin: 'http://localhost:3100' },
      payload: { workspaceId, name: `Deploy Target ${Date.now()}`, status: 'active' },
    });
    expect(systemResponse.statusCode).toBe(200);
    const systemBody = systemResponse.json() as { system: { id: string } };

    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/knowledge-records',
      headers: { cookie: adminCookie, origin: 'http://localhost:3100' },
      payload: {
        workspaceId,
        title: 'Production Deployment Guide',
        recordType: 'deployment-guide',
        lifecycleStatus: 'draft',
        systemId: systemBody.system.id,
        contentMarkdown:
          '# Deploy\n\n<script>alert(1)</script>\n\n```bash\necho hi\n```\n',
        tags: ['ops'],
        source: {
          sourceType: 'manual',
          sourceTitle: 'Hub draft',
          sourceProvider: 'project-knowledge-hub',
        },
      },
    });
    expect(createResponse.statusCode).toBe(200);
    const created = createResponse.json() as {
      knowledgeRecord: {
        id: string;
        recordType: string;
        systemId: string | null;
        lifecycleStatus: string;
        contentHtml?: string;
        source: { sourceTitle: string | null } | null;
      };
    };
    expect(created.knowledgeRecord.recordType).toBe('deployment-guide');
    expect(created.knowledgeRecord.systemId).toBe(systemBody.system.id);
    expect(created.knowledgeRecord.lifecycleStatus).toBe('draft');
    expect(created.knowledgeRecord.contentHtml?.toLowerCase()).not.toContain('<script');
    expect(created.knowledgeRecord.source?.sourceTitle).toBe('Hub draft');

    const verifyResponse = await app.inject({
      method: 'PATCH',
      url: `/api/v1/knowledge-records/${created.knowledgeRecord.id}`,
      headers: { cookie: adminCookie, origin: 'http://localhost:3100' },
      payload: { lifecycleStatus: 'verified' },
    });
    expect(verifyResponse.statusCode).toBe(200);
    const verified = verifyResponse.json() as {
      knowledgeRecord: { lifecycleStatus: string; verifiedAt: string | null };
    };
    expect(verified.knowledgeRecord.lifecycleStatus).toBe('verified');
    expect(verified.knowledgeRecord.verifiedAt).toBeTruthy();
  });

  it('blocks reader mutations and allows reader views', async () => {
    const readerCreate = await app.inject({
      method: 'POST',
      url: '/api/v1/knowledge-records',
      headers: { cookie: readerCookie, origin: 'http://localhost:3100' },
      payload: {
        workspaceId,
        title: 'Reader Record',
        recordType: 'overview',
      },
    });
    expect(readerCreate.statusCode).toBe(403);

    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/knowledge-records?workspaceId=${workspaceId}`,
      headers: { cookie: readerCookie },
    });
    expect(list.statusCode).toBe(200);
  });
});
