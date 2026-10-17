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
import { SCHEDULE_SLIP_CLOSURE_NOTE } from '@project-knowledge-hub/domain';
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

type RaidRow = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  auto: boolean;
  source: string | null;
  closureSuggested: boolean;
  slipWorkingDays: number | null;
  tasks: Array<{ id: string }>;
};

describe.skipIf(!hasIntegrationEnv)('schedule slip RAID risks', () => {
  let app: FastifyInstance | undefined;
  let redis: Redis | undefined;
  let closeDatabase: (() => Promise<void>) | undefined;
  let adminCookie = '';
  let workspaceId = '';
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
    const [admin] = await database.db
      .insert(users)
      .values({
        email: `admin-slip-${suffix}@example.com`,
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
    adminCookie = `${env.SESSION_COOKIE_NAME}=${
      login.cookies.find((cookie) => cookie.name === env.SESSION_COOKIE_NAME)?.value
    }`;
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

  function headers(json = false): Record<string, string> {
    return json
      ? { cookie: adminCookie, origin, 'content-type': 'application/json' }
      : { cookie: adminCookie, origin };
  }

  async function createProject(): Promise<string> {
    const response = await app!.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: headers(true),
      payload: { workspaceId, name: `Slip ${randomUUID()}` },
    });
    expect(response.statusCode).toBe(200);
    return (response.json() as { project: { id: string } }).project.id;
  }

  async function patchProject(
    projectId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const response = await app!.inject({
      method: 'PATCH',
      url: `/api/v1/projects/${projectId}`,
      headers: headers(true),
      payload,
    });
    expect(response.statusCode).toBe(200);
  }

  async function createTask(
    projectId: string,
    payload: Record<string, unknown>,
  ): Promise<string> {
    const response = await app!.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/tasks`,
      headers: headers(true),
      payload: { title: 'Slip task', ...payload },
    });
    expect(response.statusCode).toBe(200);
    return (response.json() as { task: { id: string } }).task.id;
  }

  async function patchTask(taskId: string, payload: Record<string, unknown>): Promise<void> {
    const response = await app!.inject({
      method: 'PATCH',
      url: `/api/v1/project-tasks/${taskId}`,
      headers: headers(true),
      payload,
    });
    expect(response.statusCode).toBe(200);
  }

  async function raidItems(projectId: string): Promise<RaidRow[]> {
    const response = await app!.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/raid-items`,
      headers: { cookie: adminCookie },
    });
    expect(response.statusCode).toBe(200);
    return (response.json() as { raidItems: RaidRow[] }).raidItems;
  }

  it('raises, updates, and flags one auto risk without closing it', async () => {
    const projectId = await createProject();
    await patchProject(projectId, {
      scheduleSlipRiskEnabled: true,
      scheduleSlipThresholdDays: 2,
    });
    const taskId = await createTask(projectId, { dueDate: '2026-11-02' });
    expect(await raidItems(projectId)).toEqual([]);

    await patchTask(taskId, { dueDate: '2026-11-06' });
    const created = await raidItems(projectId);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      auto: true,
      source: 'auto_schedule_slip',
      status: 'open',
      closureSuggested: false,
      slipWorkingDays: 4,
    });
    expect(created[0]?.title).toMatch(/Schedule slip: .+ \+4 days/);
    expect(created[0]?.tasks.map((task) => task.id)).toEqual([taskId]);

    await patchTask(taskId, { dueDate: '2026-11-20' });
    const updated = await raidItems(projectId);
    expect(updated).toHaveLength(1);
    expect(updated[0]?.id).toBe(created[0]?.id);
    expect(updated[0]?.slipWorkingDays).toBe(14);
    expect(updated[0]?.title).toMatch(/\+14 days/);
    expect(updated[0]?.status).toBe('open');

    await patchTask(taskId, { status: 'done' });
    const resolved = await raidItems(projectId);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.id).toBe(created[0]?.id);
    expect(resolved[0]?.status).toBe('open');
    expect(resolved[0]?.closureSuggested).toBe(true);
    expect(resolved[0]?.description).toContain(SCHEDULE_SLIP_CLOSURE_NOTE);
  });

  it('stays quiet when the setting is off or the slip is under the threshold', async () => {
    const off = await createProject();
    await createTask(off, { dueDate: '2026-10-01' });
    expect(await raidItems(off)).toEqual([]);

    const highBar = await createProject();
    await patchProject(highBar, {
      scheduleSlipRiskEnabled: true,
      scheduleSlipThresholdDays: 10,
    });
    const taskId = await createTask(highBar, { dueDate: '2026-11-02' });
    await patchTask(taskId, { dueDate: '2026-11-06' });
    expect(await raidItems(highBar)).toEqual([]);
  });
});
