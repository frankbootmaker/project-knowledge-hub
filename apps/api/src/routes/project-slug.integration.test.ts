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
  projects,
  users,
  workspaces,
  type Database,
} from '@project-knowledge-hub/database';
import type { McpClientContext } from '@project-knowledge-hub/mcp';
import { buildApp } from '../app.js';
import { updateProjectViaMcp } from '../lib/mcp-project-write.js';
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

describe.skipIf(!hasIntegrationEnv)('PRO-T-128 project slug history API', () => {
  let app: FastifyInstance | undefined;
  let redis: Redis | undefined;
  let database: Database | undefined;
  let closeDatabase: (() => Promise<void>) | undefined;
  let adminCookie = '';
  let maintainerCookie = '';
  let adminId = '';
  let workspaceId = '';
  let projectId = '';
  let oldSlug = '';
  let nextSlug = '';
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
    oldSlug = `outpost-${suffix}`;
    nextSlug = `relayhorizon-${suffix}`;
    const [org] = await database.db
      .insert(organizations)
      .values({ name: `Slug API ${suffix}`, slug: `slug-api-${suffix}` })
      .returning();
    const [admin] = await database.db
      .insert(users)
      .values({
        email: `slug-admin-${suffix}@example.com`,
        displayName: 'Slug Admin',
        passwordHash: await hashPassword('test-password-123'),
        isSystemAdmin: true,
        status: 'active',
      })
      .returning();
    const [maintainer] = await database.db
      .insert(users)
      .values({
        email: `slug-maintainer-${suffix}@example.com`,
        displayName: 'Slug Maintainer',
        passwordHash: await hashPassword('test-password-123'),
        isSystemAdmin: false,
        status: 'active',
      })
      .returning();
    const [workspace] = await database.db
      .insert(workspaces)
      .values({
        organizationId: org!.id,
        name: `Slugs ${suffix}`,
        slug: `slugs-${suffix}`,
      })
      .returning();
    workspaceId = workspace!.id;
    adminId = admin!.id;
    await database.db.insert(memberships).values([
      { userId: admin!.id, workspaceId, role: 'workspace_admin' },
      { userId: maintainer!.id, workspaceId, role: 'maintainer' },
    ]);
    const [project] = await database.db
      .insert(projects)
      .values({
        workspaceId,
        name: 'RelayHorizon',
        slug: oldSlug,
        status: 'active',
      })
      .returning();
    projectId = project!.id;

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

  it('renames a slug, redirects the old one, and reserves it until release', async () => {
    const renamed = await app!.inject({
      method: 'PATCH',
      url: `/api/v1/projects/${projectId}`,
      headers: { cookie: adminCookie, origin },
      payload: { slug: nextSlug },
    });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().project.slug).toBe(nextSlug);

    const resolved = await app!.inject({
      method: 'GET',
      url: `/api/v1/projects/resolve-slug?workspaceId=${workspaceId}&slug=${oldSlug}`,
      headers: { cookie: adminCookie },
    });
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json()).toMatchObject({
      redirect: true,
      project: { id: projectId, slug: nextSlug },
    });

    const taken = await app!.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { cookie: adminCookie, origin },
      payload: {
        workspaceId,
        name: 'Other project',
        slug: oldSlug,
      },
    });
    expect(taken.statusCode).toBe(409);
    expect(taken.json().error.code).toBe('PROJECT_SLUG_CONFLICT');

    const reserved = await app!.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { cookie: adminCookie, origin },
      payload: {
        workspaceId,
        name: 'Create page',
        slug: 'new',
      },
    });
    expect(reserved.statusCode).toBe(400);
    expect(reserved.json().error.code).toBe('PROJECT_SLUG_RESERVED');

    const client: McpClientContext = {
      id: randomUUID(),
      name: 'slug-test',
      organizationId: randomUUID(),
      scopes: ['projects:write'],
      allowedWorkspaceIds: [workspaceId],
      allowedProjectIds: [],
      actingUserId: adminId,
    };
    const viaMcp = await updateProjectViaMcp(app!, client, {
      projectId,
      slug: `${nextSlug}-mcp`,
    });
    expect(viaMcp.project.slug).toBe(`${nextSlug}-mcp`);

    const previous = await app!.inject({
      method: 'GET',
      url: `/api/v1/projects/resolve-slug?workspaceId=${workspaceId}&slug=${nextSlug}`,
      headers: { cookie: adminCookie },
    });
    expect(previous.statusCode).toBe(200);
    expect(previous.json().redirect).toBe(true);
    expect(previous.json().project.slug).toBe(`${nextSlug}-mcp`);

    const denied = await app!.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/slug-history/${oldSlug}/release`,
      headers: { cookie: maintainerCookie, origin },
    });
    expect(denied.statusCode).toBe(403);

    const released = await app!.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/slug-history/${oldSlug}/release`,
      headers: { cookie: adminCookie, origin },
    });
    expect(released.statusCode).toBe(200);

    const reused = await app!.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { cookie: adminCookie, origin },
      payload: {
        workspaceId,
        name: 'Reused slug',
        slug: oldSlug,
      },
    });
    expect(reused.statusCode).toBe(200);
    expect(reused.json().project.slug).toBe(oldSlug);

    const audits = await database!.db
      .select({ action: auditEvents.action })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.entityId, projectId),
          eq(auditEvents.action, 'project.slug_changed'),
        ),
      );
    expect(audits.length).toBeGreaterThan(0);
  });
});
