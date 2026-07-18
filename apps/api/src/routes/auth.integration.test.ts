import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import { eq } from 'drizzle-orm';
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
    API_URL: process.env.API_URL ?? 'http://localhost:3101',
  });
}

describe.skipIf(!hasIntegrationEnv)('Auth and workspace authorization', () => {
  let app: FastifyInstance;
  let redis: Redis;
  let closeDatabase: () => Promise<void>;
  let adminCookie = '';
  let readerCookie = '';
  let workspaceId = '';

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

    const suffix = Date.now().toString();
    const adminEmail = `admin-${suffix}@example.com`;
    const readerEmail = `reader-${suffix}@example.com`;
    const password = 'test-password-123';

    const [org] = await database.db
      .insert(organizations)
      .values({
        name: `Org ${suffix}`,
        slug: `org-${suffix}`,
      })
      .returning();

    if (!org) {
      throw new Error('Failed to create organization for tests');
    }

    const [admin] = await database.db
      .insert(users)
      .values({
        email: adminEmail,
        displayName: 'Admin',
        passwordHash: await hashPassword(password),
        isSystemAdmin: true,
        status: 'active',
      })
      .returning();

    const [reader] = await database.db
      .insert(users)
      .values({
        email: readerEmail,
        displayName: 'Reader',
        passwordHash: await hashPassword(password),
        isSystemAdmin: false,
        status: 'active',
      })
      .returning();

    if (!admin || !reader) {
      throw new Error('Failed to create users for tests');
    }

    const [workspace] = await database.db
      .insert(workspaces)
      .values({
        organizationId: org.id,
        name: `Workspace ${suffix}`,
        slug: `workspace-${suffix}`,
        description: 'test',
      })
      .returning();

    if (!workspace) {
      throw new Error('Failed to create workspace for tests');
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
      payload: { email: adminEmail, password },
    });
    expect(adminLogin.statusCode).toBe(200);
    adminCookie = adminLogin.cookies.find((cookie) => cookie.name === env.SESSION_COOKIE_NAME)
      ?.value
      ? `${env.SESSION_COOKIE_NAME}=${adminLogin.cookies.find((cookie) => cookie.name === env.SESSION_COOKIE_NAME)?.value}`
      : '';

    const readerLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: readerEmail, password },
    });
    expect(readerLogin.statusCode).toBe(200);
    readerCookie = `${env.SESSION_COOKIE_NAME}=${readerLogin.cookies.find((cookie) => cookie.name === env.SESSION_COOKIE_NAME)?.value}`;
  });

  afterAll(async () => {
    await app.close();
    try {
      await redis.quit();
    } catch {
      redis.disconnect();
    }
    await closeDatabase();
  });

  it('rejects unauthenticated session access', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/auth/session' });
    expect(response.statusCode).toBe(401);
  });

  it('allows administrator to create a workspace', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/workspaces',
      headers: {
        cookie: adminCookie,
        origin: 'http://localhost:3100',
      },
      payload: {
        name: `Created ${Date.now()}`,
        description: 'Created by admin',
      },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { workspace: { id: string; slug: string } };
    expect(body.workspace.id).toBeTruthy();
  });

  it('prevents reader from patching a workspace', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/workspaces/${workspaceId}`,
      headers: {
        cookie: readerCookie,
        origin: 'http://localhost:3100',
      },
      payload: { name: 'Nope' },
    });
    expect(response.statusCode).toBe(403);
  });

  it('allows reader to view an accessible workspace', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${workspaceId}`,
      headers: { cookie: readerCookie },
    });
    expect(response.statusCode).toBe(200);
  });

  it('expires revoked sessions', async () => {
    const logout = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: {
        cookie: readerCookie,
        origin: 'http://localhost:3100',
      },
    });
    expect(logout.statusCode).toBe(200);

    const session = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
      headers: { cookie: readerCookie },
    });
    expect(session.statusCode).toBe(401);
  });
});

describe.skipIf(!hasIntegrationEnv)('password storage', () => {
  it('stores hashed passwords only', async () => {
    const env = testEnv();
    const database = createDatabase(env.DATABASE_URL);
    try {
      const email = `hash-check-${Date.now()}@example.com`;
      const password = 'plaintext-should-not-persist';
      await database.db.insert(users).values({
        email,
        displayName: 'Hash Check',
        passwordHash: await hashPassword(password),
        status: 'active',
      });
      const [row] = await database.db.select().from(users).where(eq(users.email, email)).limit(1);
      expect(row?.passwordHash).toBeTruthy();
      expect(row?.passwordHash).not.toContain(password);
      expect(row?.passwordHash?.startsWith('scrypt$')).toBe(true);
    } finally {
      await database.close();
    }
  });
});
