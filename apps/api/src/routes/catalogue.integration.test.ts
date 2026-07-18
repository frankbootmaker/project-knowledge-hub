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

describe.skipIf(!hasIntegrationEnv)('Project and system catalogue', () => {
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
        email: `admin-m2-${suffix}@example.com`,
        displayName: 'Admin',
        passwordHash: await hashPassword(password),
        isSystemAdmin: true,
        status: 'active',
      })
      .returning();
    const [reader] = await database.db
      .insert(users)
      .values({
        email: `reader-m2-${suffix}@example.com`,
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

  it('exposes API root discovery document', async () => {
    const response = await app.inject({ method: 'GET', url: '/' });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { service: string; endpoints: { projects: string } };
    expect(body.service).toBe('project-knowledge-hub-api');
    expect(body.endpoints.projects).toBe('/api/v1/projects');
  });

  it('allows admin to create project and independent system', async () => {
    const projectResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { cookie: adminCookie, origin: 'http://localhost:3100' },
      payload: {
        workspaceId,
        name: 'Visualizer',
        status: 'active',
        tags: ['product', 'ui'],
      },
    });
    expect(projectResponse.statusCode).toBe(200);
    const projectBody = projectResponse.json() as {
      project: { id: string; slug: string; tags: Array<{ slug: string }> };
    };
    expect(projectBody.project.slug).toBe('visualizer');
    expect(projectBody.project.tags.map((tag) => tag.slug).sort()).toEqual(['product', 'ui']);

    const independentSystem = await app.inject({
      method: 'POST',
      url: '/api/v1/systems',
      headers: { cookie: adminCookie, origin: 'http://localhost:3100' },
      payload: {
        workspaceId,
        name: 'Tailscale Headscale Bridge',
        status: 'active',
        tags: ['infra'],
      },
    });
    expect(independentSystem.statusCode).toBe(200);
    const independentBody = independentSystem.json() as {
      system: { projectId: string | null; slug: string };
    };
    expect(independentBody.system.projectId).toBeNull();

    const linkedSystem = await app.inject({
      method: 'POST',
      url: '/api/v1/systems',
      headers: { cookie: adminCookie, origin: 'http://localhost:3100' },
      payload: {
        workspaceId,
        projectId: projectBody.project.id,
        name: 'Visualizer DEV',
        status: 'experimental',
      },
    });
    expect(linkedSystem.statusCode).toBe(200);
    const linkedBody = linkedSystem.json() as { system: { projectId: string | null } };
    expect(linkedBody.system.projectId).toBe(projectBody.project.id);
  });

  it('excludes archived projects by default and blocks reader mutations', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { cookie: adminCookie, origin: 'http://localhost:3100' },
      payload: { workspaceId, name: `Archive Me ${Date.now()}` },
    });
    const createdBody = created.json() as { project: { id: string } };

    const archive = await app.inject({
      method: 'DELETE',
      url: `/api/v1/projects/${createdBody.project.id}`,
      headers: { cookie: adminCookie, origin: 'http://localhost:3100' },
    });
    expect(archive.statusCode).toBe(200);

    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/projects?workspaceId=${workspaceId}`,
      headers: { cookie: adminCookie },
    });
    const listBody = list.json() as { projects: Array<{ id: string }> };
    expect(listBody.projects.some((project) => project.id === createdBody.project.id)).toBe(
      false,
    );

    const readerCreate = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { cookie: readerCookie, origin: 'http://localhost:3100' },
      payload: { workspaceId, name: 'Reader Project' },
    });
    expect(readerCreate.statusCode).toBe(403);

    const readerView = await app.inject({
      method: 'GET',
      url: `/api/v1/projects?workspaceId=${workspaceId}`,
      headers: { cookie: readerCookie },
    });
    expect(readerView.statusCode).toBe(200);
  });

  it('enforces unique slugs within a workspace', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/systems',
      headers: { cookie: adminCookie, origin: 'http://localhost:3100' },
      payload: { workspaceId, name: 'Unique Slug System', slug: 'unique-slug-system' },
    });
    expect(first.statusCode).toBe(200);

    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/v1/systems',
      headers: { cookie: adminCookie, origin: 'http://localhost:3100' },
      payload: { workspaceId, name: 'Other Name', slug: 'unique-slug-system' },
    });
    expect(duplicate.statusCode).toBe(409);
  });
});
