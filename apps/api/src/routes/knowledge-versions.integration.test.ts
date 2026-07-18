import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import { hashPassword } from '@project-knowledge-hub/auth';
import { loadEnv } from '@project-knowledge-hub/config';
import {
  createDatabase,
  knowledgeRecordVersions,
  memberships,
  organizations,
  users,
  workspaces,
} from '@project-knowledge-hub/database';
import { eq } from 'drizzle-orm';
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

describe.skipIf(!hasIntegrationEnv)('Knowledge record versioning', () => {
  let app: FastifyInstance | undefined;
  let redis: Redis | undefined;
  let closeDatabase: (() => Promise<void>) | undefined;
  let database: ReturnType<typeof createDatabase> | undefined;
  let adminCookie = '';
  let readerCookie = '';
  let workspaceId = '';
  const password = 'test-password-123';

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
        email: `admin-m4-${suffix}@example.com`,
        displayName: 'Admin',
        passwordHash: await hashPassword(password),
        isSystemAdmin: true,
        status: 'active',
      })
      .returning();
    const [reader] = await database.db
      .insert(users)
      .values({
        email: `reader-m4-${suffix}@example.com`,
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

  it('creates versions on content update and keeps history immutable', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/knowledge-records',
      headers: { cookie: adminCookie, origin: 'http://localhost:3100' },
      payload: {
        workspaceId,
        title: 'Config Snapshot A',
        recordType: 'configuration-snapshot',
        contentMarkdown: '# v1 content\n',
      },
    });
    expect(created.statusCode).toBe(200);
    const createdBody = created.json() as {
      knowledgeRecord: { id: string; currentVersionNumber: number };
    };
    expect(createdBody.knowledgeRecord.currentVersionNumber).toBe(1);

    const updated = await app.inject({
      method: 'PATCH',
      url: `/api/v1/knowledge-records/${createdBody.knowledgeRecord.id}`,
      headers: { cookie: adminCookie, origin: 'http://localhost:3100' },
      payload: {
        contentMarkdown: '# v2 content\n',
        changeMessage: 'Updated deployment steps',
      },
    });
    expect(updated.statusCode).toBe(200);
    const updatedBody = updated.json() as {
      knowledgeRecord: { currentVersionNumber: number; contentMarkdown: string };
    };
    expect(updatedBody.knowledgeRecord.currentVersionNumber).toBe(2);
    expect(updatedBody.knowledgeRecord.contentMarkdown).toContain('v2 content');

    const versions = await app.inject({
      method: 'GET',
      url: `/api/v1/knowledge-records/${createdBody.knowledgeRecord.id}/versions`,
      headers: { cookie: adminCookie },
    });
    expect(versions.statusCode).toBe(200);
    const versionsBody = versions.json() as {
      versions: Array<{ versionNumber: number; contentMarkdown: string; changeMessage: string | null }>;
    };
    expect(versionsBody.versions).toHaveLength(2);
    const v1 = versionsBody.versions.find((item) => item.versionNumber === 1);
    expect(v1?.contentMarkdown).toContain('v1 content');
    expect(v1?.changeMessage).toBe('Initial version');

    // Historical row stays unchanged even after further edits
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/knowledge-records/${createdBody.knowledgeRecord.id}`,
      headers: { cookie: adminCookie, origin: 'http://localhost:3100' },
      payload: { contentMarkdown: '# v3 content\n' },
    });

    const v1Rows = await database!.db
      .select()
      .from(knowledgeRecordVersions)
      .where(eq(knowledgeRecordVersions.knowledgeRecordId, createdBody.knowledgeRecord.id));
    const immutable = v1Rows.find((row) => row.versionNumber === 1);
    expect(immutable?.contentMarkdown).toContain('v1 content');

    const restored = await app.inject({
      method: 'POST',
      url: `/api/v1/knowledge-records/${createdBody.knowledgeRecord.id}/versions/1/restore`,
      headers: { cookie: adminCookie, origin: 'http://localhost:3100' },
      payload: {},
    });
    expect(restored.statusCode).toBe(200);
    const restoredBody = restored.json() as {
      knowledgeRecord: { currentVersionNumber: number; contentMarkdown: string };
    };
    expect(restoredBody.knowledgeRecord.currentVersionNumber).toBe(4);
    expect(restoredBody.knowledgeRecord.contentMarkdown).toContain('v1 content');
  });

  it('verifies and mark-current supersedes previous current in series', async () => {
    const system = await app.inject({
      method: 'POST',
      url: '/api/v1/systems',
      headers: { cookie: adminCookie, origin: 'http://localhost:3100' },
      payload: { workspaceId, name: `Cfg Sys ${Date.now()}`, status: 'active' },
    });
    const systemBody = system.json() as { system: { id: string } };

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/knowledge-records',
      headers: { cookie: adminCookie, origin: 'http://localhost:3100' },
      payload: {
        workspaceId,
        title: 'Current Config Old',
        recordType: 'configuration',
        systemId: systemBody.system.id,
        contentMarkdown: '# old\n',
      },
    });
    const firstBody = first.json() as { knowledgeRecord: { id: string } };

    const markFirst = await app.inject({
      method: 'POST',
      url: `/api/v1/knowledge-records/${firstBody.knowledgeRecord.id}/mark-current`,
      headers: { cookie: adminCookie, origin: 'http://localhost:3100' },
    });
    expect(markFirst.statusCode).toBe(200);
    expect(
      (markFirst.json() as { knowledgeRecord: { lifecycleStatus: string } }).knowledgeRecord
        .lifecycleStatus,
    ).toBe('current');

    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/knowledge-records',
      headers: { cookie: adminCookie, origin: 'http://localhost:3100' },
      payload: {
        workspaceId,
        title: 'Current Config New',
        recordType: 'configuration',
        systemId: systemBody.system.id,
        contentMarkdown: '# new\n',
      },
    });
    const secondBody = second.json() as { knowledgeRecord: { id: string } };

    const markSecond = await app.inject({
      method: 'POST',
      url: `/api/v1/knowledge-records/${secondBody.knowledgeRecord.id}/mark-current`,
      headers: { cookie: adminCookie, origin: 'http://localhost:3100' },
    });
    expect(markSecond.statusCode).toBe(200);
    const markSecondBody = markSecond.json() as {
      knowledgeRecord: { lifecycleStatus: string; supersedesRecordId: string | null };
      superseded: Array<{ id: string }>;
    };
    expect(markSecondBody.knowledgeRecord.lifecycleStatus).toBe('current');
    expect(markSecondBody.superseded.some((item) => item.id === firstBody.knowledgeRecord.id)).toBe(
      true,
    );

    const firstAfter = await app.inject({
      method: 'GET',
      url: `/api/v1/knowledge-records/${firstBody.knowledgeRecord.id}`,
      headers: { cookie: adminCookie },
    });
    expect(
      (firstAfter.json() as { knowledgeRecord: { lifecycleStatus: string } }).knowledgeRecord
        .lifecycleStatus,
    ).toBe('superseded');

    const verify = await app.inject({
      method: 'POST',
      url: `/api/v1/knowledge-records/${secondBody.knowledgeRecord.id}/verify`,
      headers: { cookie: adminCookie, origin: 'http://localhost:3100' },
    });
    // verify from current → verified is allowed (status change)
    expect(verify.statusCode).toBe(200);

    const readerVerify = await app.inject({
      method: 'POST',
      url: `/api/v1/knowledge-records/${secondBody.knowledgeRecord.id}/verify`,
      headers: { cookie: readerCookie, origin: 'http://localhost:3100' },
    });
    expect(readerVerify.statusCode).toBe(403);
  });
});
