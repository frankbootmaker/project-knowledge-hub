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

describe.skipIf(!hasIntegrationEnv)('Knowledge search', () => {
  let app: FastifyInstance | undefined;
  let redis: Redis | undefined;
  let closeDatabase: (() => Promise<void>) | undefined;
  let adminCookie = '';
  let outsiderCookie = '';
  let workspaceId = '';
  const password = 'test-password-123';
  const uniqueToken = `zqxbridge-${randomUUID().slice(0, 8)}`;

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
        email: `admin-m5-${suffix}@example.com`,
        displayName: 'Admin',
        passwordHash: await hashPassword(password),
        isSystemAdmin: true,
        status: 'active',
      })
      .returning();
    const [outsider] = await database.db
      .insert(users)
      .values({
        email: `outsider-m5-${suffix}@example.com`,
        displayName: 'Outsider',
        passwordHash: await hashPassword(password),
        isSystemAdmin: false,
        status: 'active',
      })
      .returning();
    if (!admin || !outsider) {
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

    app = await buildApp({ env, database, redis });
    await app.ready();

    const adminLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: admin.email, password },
    });
    adminCookie = `${env.SESSION_COOKIE_NAME}=${adminLogin.cookies.find((c) => c.name === env.SESSION_COOKIE_NAME)?.value}`;

    const outsiderLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: outsider.email, password },
    });
    outsiderCookie = `${env.SESSION_COOKIE_NAME}=${outsiderLogin.cookies.find((c) => c.name === env.SESSION_COOKIE_NAME)?.value}`;

    await app.inject({
      method: 'POST',
      url: '/api/v1/knowledge-records',
      headers: { cookie: adminCookie, origin: 'http://localhost:3100' },
      payload: {
        workspaceId,
        title: `${uniqueToken} exact title`,
        recordType: 'configuration',
        lifecycleStatus: 'draft',
        contentMarkdown: `Draft notes about ${uniqueToken} networking.`,
      },
    });

    const verified = await app.inject({
      method: 'POST',
      url: '/api/v1/knowledge-records',
      headers: { cookie: adminCookie, origin: 'http://localhost:3100' },
      payload: {
        workspaceId,
        title: `Verified ${uniqueToken} guide`,
        recordType: 'deployment-guide',
        lifecycleStatus: 'verified',
        contentMarkdown: `Verified deployment for ${uniqueToken}.`,
      },
    });
    expect(verified.statusCode).toBe(200);

    await app.inject({
      method: 'POST',
      url: '/api/v1/knowledge-records',
      headers: { cookie: adminCookie, origin: 'http://localhost:3100' },
      payload: {
        workspaceId,
        title: `Deprecated ${uniqueToken}`,
        recordType: 'configuration',
        lifecycleStatus: 'deprecated',
        contentMarkdown: `Deprecated ${uniqueToken} should be hidden.`,
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

  it('ranks exact title matches highly and prefers verified over draft', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/search?workspaceId=${workspaceId}&query=${encodeURIComponent(uniqueToken)}`,
      headers: { cookie: adminCookie },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      results: Array<{ title: string; lifecycleStatus: string; excerpt: string; score: number }>;
    };
    expect(body.results.length).toBeGreaterThanOrEqual(2);
    expect(body.results.every((item) => item.lifecycleStatus !== 'deprecated')).toBe(true);

    const exact = await app.inject({
      method: 'POST',
      url: '/api/v1/search',
      headers: { cookie: adminCookie, origin: 'http://localhost:3100' },
      payload: {
        workspaceId,
        query: `${uniqueToken} exact title`,
      },
    });
    expect(exact.statusCode).toBe(200);
    const exactBody = exact.json() as {
      results: Array<{ title: string; lifecycleStatus: string }>;
    };
    expect(exactBody.results[0]?.title.toLowerCase()).toContain('exact title');

    const verifiedIdx = body.results.findIndex((item) => item.lifecycleStatus === 'verified');
    const draftIdx = body.results.findIndex((item) => item.lifecycleStatus === 'draft');
    expect(verifiedIdx).toBeGreaterThanOrEqual(0);
    expect(draftIdx).toBeGreaterThanOrEqual(0);
    expect(verifiedIdx).toBeLessThan(draftIdx);
    expect(body.results[0]?.excerpt.length).toBeGreaterThan(0);
  });

  it('never reveals unauthorized workspace records', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/search?workspaceId=${workspaceId}&query=${encodeURIComponent(uniqueToken)}`,
      headers: { cookie: outsiderCookie },
    });
    expect(response.statusCode).toBe(403);
  });
});
