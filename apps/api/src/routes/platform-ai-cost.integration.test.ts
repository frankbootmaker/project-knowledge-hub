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
import { roundAiMoney } from '@project-knowledge-hub/domain';
import { buildApp } from '../app.js';
import type { FastifyInstance } from 'fastify';

const hasIntegrationEnv = Boolean(process.env.DATABASE_URL) && Boolean(process.env.REDIS_URL);

type ChartPoint = {
  period: string;
  currency: string;
  subscription: number;
  planChange: number;
  onDemand: number;
  paidCost: number;
  theoreticalApiCost: number;
};

type PlatformMonth = ChartPoint & {
  workspaceId: string;
  workspaceSlug: string;
  difference: number;
  ratio: number | null;
};

type PlatformReport = {
  from: string;
  to: string;
  months: PlatformMonth[];
  totals: Array<ChartPoint & { difference: number; ratio: number | null }>;
  entries: Array<{
    id: string;
    workspaceId: string;
    workspaceSlug: string;
    type: string;
    provider: string;
    period: string;
    amount: number;
    currency: string;
  }>;
};

function testEnv() {
  return loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    APP_ENV: 'test',
    LOG_LEVEL: 'silent',
    SESSION_SECRET: process.env.SESSION_SECRET ?? 'test-session-secret-at-least-32-chars',
    WEB_URL: process.env.WEB_URL ?? 'http://localhost:3100',
  });
}

describe.skipIf(!hasIntegrationEnv)('platform AI cost', () => {
  let app: FastifyInstance | undefined;
  let redis: Redis | undefined;
  let closeDatabase: (() => Promise<void>) | undefined;
  let adminCookie = '';
  let memberCookie = '';
  let alphaId = '';
  let betaId = '';
  let alphaSlug = '';
  let betaSlug = '';

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
    const password = 'test-password-123';
    const [org] = await database.db
      .insert(organizations)
      .values({ name: `Org ${suffix}`, slug: `org-${suffix}` })
      .returning();
    if (!org) throw new Error('org missing');

    const [admin] = await database.db
      .insert(users)
      .values({
        email: `admin-ai-${suffix}@example.com`,
        displayName: 'Admin',
        passwordHash: await hashPassword(password),
        isSystemAdmin: true,
        status: 'active',
      })
      .returning();
    const [member] = await database.db
      .insert(users)
      .values({
        email: `member-ai-${suffix}@example.com`,
        displayName: 'Member',
        passwordHash: await hashPassword(password),
        isSystemAdmin: false,
        status: 'active',
      })
      .returning();
    if (!admin || !member) throw new Error('users missing');

    alphaSlug = `alpha-${suffix}`;
    betaSlug = `beta-${suffix}`;
    const [alpha] = await database.db
      .insert(workspaces)
      .values({ organizationId: org.id, name: `Alpha ${suffix}`, slug: alphaSlug })
      .returning();
    const [beta] = await database.db
      .insert(workspaces)
      .values({ organizationId: org.id, name: `Beta ${suffix}`, slug: betaSlug })
      .returning();
    if (!alpha || !beta) throw new Error('workspaces missing');
    alphaId = alpha.id;
    betaId = beta.id;
    await database.db.insert(memberships).values({
      userId: member.id,
      workspaceId: alpha.id,
      role: 'workspace_admin',
    });

    app = await buildApp({ env, database, redis });
    await app.ready();

    const adminLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: admin.email, password },
    });
    adminCookie = `${env.SESSION_COOKIE_NAME}=${adminLogin.cookies.find((cookie) => cookie.name === env.SESSION_COOKIE_NAME)?.value}`;
    const memberLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: member.email, password },
    });
    memberCookie = `${env.SESSION_COOKIE_NAME}=${memberLogin.cookies.find((cookie) => cookie.name === env.SESSION_COOKIE_NAME)?.value}`;

    const entries = [
      {
        workspaceId: alphaId,
        body: {
          period: '2026-10',
          provider: 'Cursor',
          type: 'subscription',
          amount: 100,
          currency: 'EUR',
        },
      },
      {
        workspaceId: alphaId,
        body: {
          period: '2026-10',
          provider: 'Cursor',
          type: 'plan_change',
          amount: -20,
          currency: 'EUR',
          note: 'downgrade credit',
        },
      },
      {
        workspaceId: alphaId,
        body: {
          period: '2026-10',
          provider: 'Cursor',
          type: 'on_demand',
          amount: 10,
          currency: 'EUR',
        },
      },
      {
        workspaceId: alphaId,
        body: {
          period: '2026-10',
          provider: 'Cursor',
          type: 'subscription',
          amount: 5,
          currency: 'USD',
        },
      },
      {
        workspaceId: alphaId,
        body: {
          period: '2026-08',
          provider: 'Cursor',
          type: 'subscription',
          amount: 999,
          currency: 'EUR',
        },
      },
      {
        workspaceId: betaId,
        body: {
          period: '2026-10',
          provider: 'OpenAI',
          type: 'subscription',
          amount: 40,
          currency: 'EUR',
        },
      },
      {
        workspaceId: betaId,
        body: {
          period: '2026-10',
          provider: 'OpenAI',
          type: 'on_demand',
          amount: 8,
          currency: 'EUR',
        },
      },
    ];
    for (const entry of entries) {
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${entry.workspaceId}/ai-billing-entries`,
        headers: { cookie: adminCookie, origin: 'http://localhost:3100' },
        payload: entry.body,
      });
      expect(response.statusCode).toBe(200);
    }
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

  async function workspaceChart(workspaceId: string): Promise<ChartPoint[]> {
    const response = await app!.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${workspaceId}/ai-cost`,
      headers: { cookie: adminCookie },
    });
    expect(response.statusCode).toBe(200);
    return (response.json() as { chart: ChartPoint[] }).chart;
  }

  it('returns 403 for a workspace admin who is not a system admin', async () => {
    const response = await app!.inject({
      method: 'GET',
      url: '/api/v1/admin/ai-cost',
      headers: { cookie: memberCookie },
    });
    expect(response.statusCode).toBe(403);
  });

  it('matches each workspace chart and keeps currencies apart', async () => {
    const response = await app!.inject({
      method: 'GET',
      url: '/api/v1/admin/ai-cost?from=2026-09&to=2026-10',
      headers: { cookie: adminCookie },
    });
    expect(response.statusCode).toBe(200);
    const report = response.json() as PlatformReport;
    expect(report.from).toBe('2026-09');
    expect(report.to).toBe('2026-10');

    const charts = new Map<string, ChartPoint[]>([
      [alphaId, await workspaceChart(alphaId)],
      [betaId, await workspaceChart(betaId)],
    ]);
    for (const [workspaceId, chart] of charts) {
      for (const point of chart) {
        if (point.period < '2026-09' || point.period > '2026-10') continue;
        const row = report.months.find(
          (month) =>
            month.workspaceId === workspaceId &&
            month.period === point.period &&
            month.currency === point.currency,
        );
        expect(row).toMatchObject({
          subscription: point.subscription,
          planChange: point.planChange,
          onDemand: point.onDemand,
          paidCost: point.paidCost,
          theoreticalApiCost: point.theoreticalApiCost,
        });
      }
    }

    expect(
      report.months.some((month) => month.workspaceId === alphaId && month.period === '2026-08'),
    ).toBe(false);

    const alphaEur = report.months.find(
      (month) =>
        month.workspaceId === alphaId && month.period === '2026-10' && month.currency === 'EUR',
    );
    const betaEur = report.months.find(
      (month) =>
        month.workspaceId === betaId && month.period === '2026-10' && month.currency === 'EUR',
    );
    const alphaUsd = report.months.find(
      (month) =>
        month.workspaceId === alphaId && month.period === '2026-10' && month.currency === 'USD',
    );
    expect(alphaEur).toMatchObject({
      subscription: 100,
      planChange: -20,
      onDemand: 10,
      paidCost: 90,
      workspaceSlug: alphaSlug,
    });
    expect(betaEur).toMatchObject({ paidCost: 48, workspaceSlug: betaSlug });
    expect(alphaUsd).toMatchObject({ paidCost: 5 });
    expect(roundAiMoney((alphaEur?.paidCost ?? 0) + (betaEur?.paidCost ?? 0))).toBe(138);

    for (const total of report.totals) {
      const rows = report.months.filter(
        (month) => month.period === total.period && month.currency === total.currency,
      );
      expect(total.paidCost).toBe(roundAiMoney(rows.reduce((sum, row) => sum + row.paidCost, 0)));
      expect(total.theoreticalApiCost).toBe(
        roundAiMoney(rows.reduce((sum, row) => sum + row.theoreticalApiCost, 0)),
      );
      expect(total.planChange).toBe(
        roundAiMoney(rows.reduce((sum, row) => sum + row.planChange, 0)),
      );
      expect(total.difference).toBe(
        roundAiMoney(rows.reduce((sum, row) => sum + row.difference, 0)),
      );
      expect(rows.every((row) => row.currency === total.currency)).toBe(true);
    }

    const eurTotal = report.totals.find(
      (row) => row.period === '2026-10' && row.currency === 'EUR',
    );
    const usdTotal = report.totals.find(
      (row) => row.period === '2026-10' && row.currency === 'USD',
    );
    expect(eurTotal?.currency).toBe('EUR');
    expect(usdTotal?.currency).toBe('USD');
    expect(eurTotal?.paidCost).not.toBe(usdTotal?.paidCost);
  });

  it('filters cost entries and keeps the workspace slug for the edit link', async () => {
    const response = await app!.inject({
      method: 'GET',
      url:
        `/api/v1/admin/ai-cost?from=2026-09&to=2026-10` +
        `&workspaceId=${alphaId}&provider=Cursor&type=plan_change&period=2026-10`,
      headers: { cookie: adminCookie },
    });
    expect(response.statusCode).toBe(200);
    const report = response.json() as PlatformReport;
    expect(report.entries).toHaveLength(1);
    expect(report.entries[0]).toMatchObject({
      workspaceId: alphaId,
      workspaceSlug: alphaSlug,
      type: 'plan_change',
      provider: 'Cursor',
      period: '2026-10',
      amount: -20,
      currency: 'EUR',
    });
  });
});
