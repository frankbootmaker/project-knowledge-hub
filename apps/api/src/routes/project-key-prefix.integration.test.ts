import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { hashPassword } from '@project-knowledge-hub/auth';
import { loadEnv } from '@project-knowledge-hub/config';
import {
  auditEvents,
  createDatabase,
  memberships,
  organizations,
  projectTasks,
  projects,
  users,
  workspaces,
  type Database,
} from '@project-knowledge-hub/database';
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
    WEB_URL: 'http://localhost:3100',
  });
}

describe.skipIf(!hasIntegrationEnv)('PRO-T-127 key prefix history API', () => {
  let app: FastifyInstance | undefined;
  let redis: Redis | undefined;
  let database: Database | undefined;
  let closeDatabase: (() => Promise<void>) | undefined;
  let adminCookie = '';
  let maintainerCookie = '';
  let workspaceId = '';
  let projectId = '';
  let taskId = '';
  let oldPrefix = '';
  let nextPrefix = '';
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

    const suffix = randomUUID().slice(0, 8);
    oldPrefix = await allocateGlobalIntegrationKeyPrefix(database);
    nextPrefix = await allocateGlobalIntegrationKeyPrefix(database);
    const [org] = await database.db
      .insert(organizations)
      .values({ name: `Key API ${suffix}`, slug: `key-api-${suffix}` })
      .returning();
    const [admin] = await database.db
      .insert(users)
      .values({
        email: `key-admin-${suffix}@example.com`,
        displayName: 'Key Admin',
        passwordHash: await hashPassword('test-password-123'),
        isSystemAdmin: true,
        status: 'active',
      })
      .returning();
    const [maintainer] = await database.db
      .insert(users)
      .values({
        email: `key-maintainer-${suffix}@example.com`,
        displayName: 'Key Maintainer',
        passwordHash: await hashPassword('test-password-123'),
        isSystemAdmin: false,
        status: 'active',
      })
      .returning();
    const [workspace] = await database.db
      .insert(workspaces)
      .values({
        organizationId: org!.id,
        name: `Keys ${suffix}`,
        slug: `keys-${suffix}`,
      })
      .returning();
    workspaceId = workspace!.id;
    await database.db.insert(memberships).values([
      { userId: admin!.id, workspaceId, role: 'workspace_admin' },
      { userId: maintainer!.id, workspaceId, role: 'maintainer' },
    ]);
    const [project] = await database.db
      .insert(projects)
      .values({
        workspaceId,
        name: 'Outpost',
        slug: `outpost-${suffix}`,
        keyPrefix: oldPrefix,
        status: 'active',
      })
      .returning();
    projectId = project!.id;
    const [task] = await database.db
      .insert(projectTasks)
      .values({
        projectId,
        title: 'Old key task',
        issueKeyType: 'T',
        issueNumber: 4,
      })
      .returning();
    taskId = task!.id;

    app = await buildApp({ env, database, redis });
    await app.ready();

    async function login(email: string) {
      const response = await app!.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email, password: 'test-password-123' },
      });
      expect(response.statusCode).toBe(200);
      return `${env.SESSION_COOKIE_NAME}=${
        response.cookies.find((cookie) => cookie.name === env.SESSION_COOKIE_NAME)?.value
      }`;
    }

    adminCookie = await login(admin!.email);
    maintainerCookie = await login(maintainer!.email);
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

  it('resolves the old key, reserves it, and lets an admin release it', async () => {
    const renamed = await app!.inject({
      method: 'PATCH',
      url: `/api/v1/projects/${projectId}`,
      headers: { cookie: adminCookie, origin },
      payload: { keyPrefix: nextPrefix },
    });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().project.keyPrefix).toBe(nextPrefix);

    const resolved = await app!.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/resolve-issue-key?key=${oldPrefix}-T-4`,
      headers: { cookie: adminCookie },
    });
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json()).toMatchObject({
      entityType: 'task',
      entityId: taskId,
      queryParam: 'task',
    });

    const taken = await app!.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { cookie: adminCookie, origin },
      payload: {
        workspaceId,
        name: 'Other project',
        slug: `other-${randomUUID().slice(0, 8)}`,
        keyPrefix: oldPrefix,
      },
    });
    expect(taken.statusCode).toBe(409);
    expect(taken.json().error.code).toBe('KEY_PREFIX_TAKEN');

    const denied = await app!.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/key-prefix-history/${oldPrefix}/release`,
      headers: { cookie: maintainerCookie, origin },
    });
    expect(denied.statusCode).toBe(403);

    const released = await app!.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/key-prefix-history/${oldPrefix}/release`,
      headers: { cookie: adminCookie, origin },
    });
    expect(released.statusCode).toBe(200);

    const audits = await database!.db
      .select({ action: auditEvents.action })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.entityId, projectId),
          eq(auditEvents.action, 'project.key_prefix_changed'),
        ),
      );
    expect(audits.length).toBeGreaterThan(0);
  });
});
