import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import { hashPassword } from '@project-knowledge-hub/auth';
import { loadEnv } from '@project-knowledge-hub/config';
import {
  createDatabase,
  knowledgeRecords,
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

type RaidPayload = {
  id: string;
  probability: string | null;
  impact: string | null;
  humanKey: string | null;
  records: Array<{ id: string }>;
};

describe.skipIf(!hasIntegrationEnv)('RAID ratings and record links', () => {
  let app: FastifyInstance | undefined;
  let redis: Redis | undefined;
  let closeDatabase: (() => Promise<void>) | undefined;
  let database: ReturnType<typeof createDatabase> | undefined;
  let adminCookie = '';
  let adminId = '';
  let workspaceId = '';
  const password = 'test-password-123';
  const origin = 'http://localhost:3100';

  beforeAll(async () => {
    const env = testEnv();
    database = createDatabase(env.DATABASE_URL);
    closeDatabase = () => database?.close() ?? Promise.resolve();
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
    const [admin] = await database.db
      .insert(users)
      .values({
        email: `admin-raid-${suffix}@example.com`,
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
    if (!org || !admin || !workspace) throw new Error('fixture missing');
    adminId = admin.id;
    workspaceId = workspace.id;
    await database.db.insert(memberships).values({
      userId: admin.id,
      workspaceId: workspace.id,
      role: 'workspace_admin',
    });

    app = await buildApp({ env, database, redis });
    await app.ready();
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: admin.email, password },
    });
    adminCookie = `${env.SESSION_COOKIE_NAME}=${login.cookies.find((cookie) => cookie.name === env.SESSION_COOKIE_NAME)?.value}`;
  });

  afterAll(async () => {
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

  async function createProject(): Promise<string> {
    const response = await app!.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { cookie: adminCookie, origin },
      payload: { workspaceId, name: `RAID ${randomUUID()}` },
    });
    expect(response.statusCode).toBe(200);
    return (response.json() as { project: { id: string } }).project.id;
  }

  async function createRecord(projectId: string): Promise<string> {
    const suffix = randomUUID();
    const [row] = await database!.db
      .insert(knowledgeRecords)
      .values({
        workspaceId,
        projectId,
        title: `Note ${suffix}`,
        slug: `note-${suffix}`,
        recordType: 'note',
        createdBy: adminId,
      })
      .returning();
    if (!row) throw new Error('record missing');
    return row.id;
  }

  it('stores optional ratings and same-project record links, and copies both on transfer', async () => {
    const projectId = await createProject();
    const otherProjectId = await createProject();
    const recordId = await createRecord(projectId);
    const otherRecordId = await createRecord(otherProjectId);

    const created = await app!.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/raid-items`,
      headers: { cookie: adminCookie, origin },
      payload: { kind: 'risk', title: 'Competitor risk' },
    });
    expect(created.statusCode).toBe(200);
    const createdItem = (created.json() as { raidItem: RaidPayload }).raidItem;
    expect(createdItem.probability).toBeNull();
    expect(createdItem.impact).toBeNull();

    const patched = await app!.inject({
      method: 'PATCH',
      url: `/api/v1/project-raid-items/${createdItem.id}`,
      headers: { cookie: adminCookie, origin },
      payload: { probability: 'medium', impact: 'high' },
    });
    expect(patched.statusCode).toBe(200);
    const patchedItem = (patched.json() as { raidItem: RaidPayload }).raidItem;
    expect(patchedItem.probability).toBe('medium');
    expect(patchedItem.impact).toBe('high');

    const rejected = await app!.inject({
      method: 'PUT',
      url: `/api/v1/project-raid-items/${createdItem.id}/records`,
      headers: { cookie: adminCookie, origin },
      payload: { recordIds: [otherRecordId] },
    });
    expect(rejected.statusCode).toBe(400);
    expect((rejected.json() as { error: { code: string } }).error.code).toBe(
      'RAID_RECORD_PROJECT_MISMATCH',
    );

    const linked = await app!.inject({
      method: 'PUT',
      url: `/api/v1/project-raid-items/${createdItem.id}/records`,
      headers: { cookie: adminCookie, origin },
      payload: { recordIds: [recordId] },
    });
    expect(linked.statusCode).toBe(200);
    expect(
      (linked.json() as { raidItem: RaidPayload }).raidItem.records.map(
        (record) => record.id,
      ),
    ).toEqual([recordId]);

    const transferred = await app!.inject({
      method: 'POST',
      url: `/api/v1/project-raid-items/${createdItem.id}/transfer`,
      headers: { cookie: adminCookie, origin },
      payload: { targetKind: 'issue' },
    });
    expect(transferred.statusCode).toBe(200);
    const target = (transferred.json() as { target: RaidPayload }).target;
    expect(target.probability).toBe('medium');
    expect(target.impact).toBe('high');
    expect(target.records.map((record) => record.id)).toEqual([recordId]);

    const cleared = await app!.inject({
      method: 'PATCH',
      url: `/api/v1/project-raid-items/${target.id}`,
      headers: { cookie: adminCookie, origin },
      payload: { probability: null, impact: null },
    });
    expect(cleared.statusCode).toBe(200);
    const clearedItem = (cleared.json() as { raidItem: RaidPayload }).raidItem;
    expect(clearedItem.probability).toBeNull();
    expect(clearedItem.impact).toBeNull();
  });
});
