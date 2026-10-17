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

const HEADER = [
  'Date',
  'Cloud Agent ID',
  'Automation ID',
  'Kind',
  'Model',
  'Max Mode',
  'Input (w/ Cache Write)',
  'Input (w/o Cache Write)',
  'Cache Read',
  'Output Tokens',
  'Total Tokens',
  'Cost',
].join(',');

const AGENT = `bc-usage-${randomUUID()}`;

const AGENT_ROW_A =
  `"2026-10-17T14:27:59.240Z","${AGENT}","","Included","composer-2.5","No","0","77552","471741","4013","553306","Included"`;
const AGENT_ROW_B =
  `"2026-10-17T13:24:00.025Z","${AGENT}","","Included","composer-2.5","No","0","7804","811858","1991","821653","Included"`;
const PLAIN_ROW =
  '"2026-10-17T14:52:56.907Z","","","Included","grok-bot-default","No","550","2","61231","580","62363","Included"';
const BAD_ROW =
  '"2026-10-17T01:00:00.000Z","","","Included","grok-bot-default","No","nope","2","1","1","4","Free"';
const EMPTY_ROW =
  '"2026-10-16T08:00:00.000Z","","","Included","grok-bot-default","No","","","","","","Free"';
const EMPTY_AUTOMATION_ROW =
  '"2026-10-16T09:00:00.000Z","","","Included","grok-bot-automation","No","","","","","","Free"';
const EXTRA_ROW =
  `"2026-10-18T00:00:00.000Z","${AGENT}","","Included","composer-2.5","Yes","10","3","4","5","22","Included"`;

const CSV = [
  HEADER,
  AGENT_ROW_A,
  AGENT_ROW_B,
  PLAIN_ROW,
  BAD_ROW,
  EMPTY_ROW,
  EMPTY_AUTOMATION_ROW,
].join('\n');

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

type TaskBody = {
  id: string;
  tokensUsed: number | null;
  tokensInput: number | null;
  tokensOutput: number | null;
  tokensCache: number | null;
  tokensCacheWrite: number | null;
  modelId: string | null;
  pricingTier: string | null;
  billingPeriod: string | null;
  cloudAgentId: string | null;
};

describe.skipIf(!hasIntegrationEnv)('AI usage CSV import', () => {
  let app: FastifyInstance | undefined;
  let redis: Redis | undefined;
  let closeDatabase: (() => Promise<void>) | undefined;
  let adminCookie = '';
  let maintainerCookie = '';
  let readerCookie = '';
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
    const [workspace] = await database.db
      .insert(workspaces)
      .values({
        organizationId: org?.id ?? '',
        name: `WS ${suffix}`,
        slug: `ws-${suffix}`,
      })
      .returning();
    if (!org || !workspace) throw new Error('fixture missing');
    workspaceId = workspace.id;

    async function user(role: 'workspace_admin' | 'maintainer' | 'reader', label: string) {
      const [row] = await database.db
        .insert(users)
        .values({
          email: `${label}-${suffix}@example.com`,
          displayName: label,
          passwordHash: await hashPassword(password),
          isSystemAdmin: false,
          status: 'active',
        })
        .returning();
      if (!row) throw new Error('user missing');
      await database.db.insert(memberships).values({
        userId: row.id,
        workspaceId: workspace.id,
        role,
      });
      return row.email;
    }

    const adminEmail = await user('workspace_admin', 'admin');
    const maintainerEmail = await user('maintainer', 'maintainer');
    const readerEmail = await user('reader', 'reader');

    app = await buildApp({ env, database, redis });
    await app.ready();

    async function login(email: string) {
      const response = await app!.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email, password },
      });
      const cookie = response.cookies.find((item) => item.name === env.SESSION_COOKIE_NAME);
      return `${env.SESSION_COOKIE_NAME}=${cookie?.value ?? ''}`;
    }

    adminCookie = await login(adminEmail);
    maintainerCookie = await login(maintainerEmail);
    readerCookie = await login(readerEmail);
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

  function headers(cookie: string) {
    return { cookie, origin };
  }

  it('lets members read the log and only a workspace admin import', async () => {
    const readerList = await app!.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${workspaceId}/ai-usage-imports`,
      headers: headers(readerCookie),
    });
    expect(readerList.statusCode).toBe(200);
    expect(readerList.json()).toEqual({ imports: [] });

    const readerImport = await app!.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${workspaceId}/ai-usage-imports`,
      headers: headers(readerCookie),
      payload: { csv: CSV, fileName: 'cursor-usage.csv' },
    });
    expect(readerImport.statusCode).toBe(403);

    const maintainerPreview = await app!.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${workspaceId}/ai-usage-imports/preview`,
      headers: headers(maintainerCookie),
      payload: { csv: CSV, fileName: 'cursor-usage.csv' },
    });
    expect(maintainerPreview.statusCode).toBe(403);
  });

  it('previews, imports, links on cloud agent id, and skips duplicates', async () => {
    const project = await app!.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: headers(adminCookie),
      payload: { workspaceId, name: `Usage ${randomUUID()}` },
    });
    expect(project.statusCode).toBe(200);
    const projectId = (project.json() as { project: { id: string } }).project.id;

    const created = await app!.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/tasks`,
      headers: headers(adminCookie),
      payload: { title: 'Cloud agent task' },
    });
    expect(created.statusCode).toBe(200);
    const taskId = (created.json() as { task: TaskBody }).task.id;

    const preview = await app!.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${workspaceId}/ai-usage-imports/preview`,
      headers: headers(adminCookie),
      payload: { csv: CSV, fileName: 'cursor-usage.csv' },
    });
    expect(preview.statusCode).toBe(200);
    const previewBody = preview.json() as {
      rowCountTotal: number;
      rowCountInserted: number;
      rowCountLinked: number;
      rowCountErrors: number;
      rowCountNoTokens: number;
      totals: { tokensInput: number; tokensCacheWrite: number; tokensTotal: number };
      models: Array<{ model: string }>;
    };
    expect(previewBody.rowCountTotal).toBe(6);
    expect(previewBody.rowCountInserted).toBe(3);
    expect(previewBody.rowCountLinked).toBe(0);
    expect(previewBody.rowCountErrors).toBe(1);
    expect(previewBody.rowCountNoTokens).toBe(2);
    expect(previewBody.totals.tokensCacheWrite).toBe(550);
    expect(previewBody.totals.tokensInput).toBe(2 + 77552 + 7804);
    expect(previewBody.models.map((model) => model.model)).toContain('composer-2.5');

    const imported = await app!.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${workspaceId}/ai-usage-imports`,
      headers: headers(adminCookie),
      payload: { csv: CSV, fileName: 'cursor-usage.csv' },
    });
    expect(imported.statusCode).toBe(200);
    const first = (imported.json() as { import: {
      rowCountInserted: number;
      rowCountDuplicate: number;
      rowCountLinked: number;
      rowCountErrors: number;
      rowCountNoTokens: number;
      source: string;
      fileName: string | null;
      createdBy: { displayName: string } | null;
      errors: Array<{ message: string }>;
    } }).import;
    expect(first.source).toBe('csv');
    expect(first.fileName).toBe('cursor-usage.csv');
    expect(first.createdBy?.displayName).toBe('admin');
    expect(first.rowCountInserted).toBe(3);
    expect(first.rowCountDuplicate).toBe(0);
    expect(first.rowCountLinked).toBe(0);
    expect(first.rowCountErrors).toBe(1);
    expect(first.rowCountNoTokens).toBe(2);
    expect(first.errors[0]?.message).toMatch(/whole number/);

    const unassigned = await app!.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${workspaceId}/ai-usage-events/unassigned`,
      headers: headers(readerCookie),
    });
    expect(unassigned.statusCode).toBe(200);
    const groups = (unassigned.json() as {
      total: number;
      groups: Array<{ cloudAgentId: string | null; rowCount: number }>;
    });
    expect(groups.total).toBe(3);
    expect(groups.groups.some((group) => group.cloudAgentId === AGENT)).toBe(true);

    const linked = await app!.inject({
      method: 'PATCH',
      url: `/api/v1/project-tasks/${taskId}`,
      headers: headers(adminCookie),
      payload: { cloudAgentId: AGENT },
    });
    expect(linked.statusCode).toBe(200);
    const task = (linked.json() as { task: TaskBody }).task;
    expect(task.cloudAgentId).toBe(AGENT);
    expect(task.tokensInput).toBe(77552 + 7804);
    expect(task.tokensCacheWrite).toBe(0);
    expect(task.tokensCache).toBe(471741 + 811858);
    expect(task.tokensOutput).toBe(4013 + 1991);
    expect(task.tokensUsed).toBe(1374959);
    expect(task.modelId).toBe('composer-2.5');
    expect(task.pricingTier).toBe('standard');
    expect(task.billingPeriod).toBe('2026-10');

    const again = await app!.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${workspaceId}/ai-usage-imports`,
      headers: headers(adminCookie),
      payload: { csv: CSV, fileName: 'cursor-usage.csv' },
    });
    expect(again.statusCode).toBe(200);
    const second = (again.json() as { import: {
      rowCountInserted: number;
      rowCountDuplicate: number;
      rowCountLinked: number;
      rowCountNoTokens: number;
    } }).import;
    expect(second.rowCountInserted).toBe(0);
    expect(second.rowCountDuplicate).toBe(3);
    expect(second.rowCountLinked).toBe(0);
    expect(second.rowCountNoTokens).toBe(2);

    const overlap = await app!.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${workspaceId}/ai-usage-imports`,
      headers: headers(adminCookie),
      payload: { csv: [HEADER, AGENT_ROW_A, EXTRA_ROW].join('\n'), fileName: 'overlap.csv' },
    });
    expect(overlap.statusCode).toBe(200);
    const third = (overlap.json() as { import: {
      rowCountInserted: number;
      rowCountDuplicate: number;
      rowCountLinked: number;
    } }).import;
    expect(third.rowCountInserted).toBe(1);
    expect(third.rowCountDuplicate).toBe(1);
    expect(third.rowCountLinked).toBe(1);

    const after = await app!.inject({
      method: 'GET',
      url: `/api/v1/project-tasks/${taskId}`,
      headers: headers(readerCookie),
    });
    const updated = (after.json() as { task: TaskBody }).task;
    expect(updated.tokensInput).toBe(77552 + 7804 + 3);
    expect(updated.tokensCacheWrite).toBe(10);
    expect(updated.tokensUsed).toBe(1374959 + 22);
    expect(updated.pricingTier).toBe('max');

    const log = await app!.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${workspaceId}/ai-usage-imports`,
      headers: headers(readerCookie),
    });
    const imports = (log.json() as { imports: Array<{ fileName: string | null }> }).imports;
    expect(imports.map((item) => item.fileName)).toEqual([
      'overlap.csv',
      'cursor-usage.csv',
      'cursor-usage.csv',
    ]);
  });
});
