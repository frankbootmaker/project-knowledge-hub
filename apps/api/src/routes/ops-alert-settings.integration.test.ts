import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { hashPassword } from '@project-knowledge-hub/auth';
import { loadEnv } from '@project-knowledge-hub/config';
import {
  OPS_ALERT_SETTINGS_KEY,
  auditEvents,
  clearStoredOpsAlertSettings,
  createDatabase,
  platformSettings,
  readStoredOpsAlertSettings,
  users,
  type Database,
} from '@project-knowledge-hub/database';
import { buildApp } from '../app.js';
import type { FastifyInstance } from 'fastify';

const hasIntegrationEnv =
  Boolean(process.env.DATABASE_URL) && Boolean(process.env.REDIS_URL);

type AlertSettingsBody = {
  settings: {
    source: 'override' | 'env';
    thresholds: { diskFreeGbMin: number };
    audit: {
      retentionDays: number;
      source: 'override' | 'env';
    };
    env: { auditRetentionDays: number };
  };
};

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

describe.skipIf(!hasIntegrationEnv)('ops alert settings', () => {
  let app: FastifyInstance | undefined;
  let redis: Redis | undefined;
  let database: Database | undefined;
  let adminCookie = '';
  let adminId = '';
  let originalRow: {
    value: string;
    updatedBy: string | null;
    updatedAt: Date;
  } | null = null;

  beforeAll(async () => {
    const env = testEnv();
    database = createDatabase(env.DATABASE_URL);
    redis = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      enableOfflineQueue: false,
      retryStrategy: () => null,
    });
    await redis.connect();

    const [existing] = await database.db
      .select({
        value: platformSettings.value,
        updatedBy: platformSettings.updatedBy,
        updatedAt: platformSettings.updatedAt,
      })
      .from(platformSettings)
      .where(eq(platformSettings.key, OPS_ALERT_SETTINGS_KEY))
      .limit(1);
    originalRow = existing ?? null;

    const suffix = randomUUID();
    const password = 'test-password-123';
    const [admin] = await database.db
      .insert(users)
      .values({
        email: `admin-alerts-${suffix}@example.com`,
        displayName: 'Alerts admin',
        passwordHash: await hashPassword(password),
        isSystemAdmin: true,
        status: 'active',
      })
      .returning();
    if (!admin) throw new Error('admin missing');
    adminId = admin.id;

    app = await buildApp({ env, database, redis });
    await app.ready();

    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: admin.email, password },
    });
    expect(login.statusCode).toBe(200);
    const token = login.cookies.find(
      (cookie) => cookie.name === env.SESSION_COOKIE_NAME,
    )?.value;
    if (!token) throw new Error('session cookie missing');
    adminCookie = `${env.SESSION_COOKIE_NAME}=${token}`;
  });

  afterAll(async () => {
    if (database) {
      if (originalRow) {
        await database.db
          .insert(platformSettings)
          .values({
            key: OPS_ALERT_SETTINGS_KEY,
            value: originalRow.value,
            updatedBy: originalRow.updatedBy,
            updatedAt: originalRow.updatedAt,
          })
          .onConflictDoUpdate({
            target: platformSettings.key,
            set: {
              value: originalRow.value,
              updatedBy: originalRow.updatedBy,
              updatedAt: originalRow.updatedAt,
            },
          });
      } else {
        await clearStoredOpsAlertSettings(database);
      }
      if (adminId) {
        await database.db.delete(auditEvents).where(eq(auditEvents.actorId, adminId));
        await database.db.delete(users).where(eq(users.id, adminId));
      }
    }
    if (app) await app.close();
    if (redis) {
      try {
        await redis.quit();
      } catch {
        redis.disconnect();
      }
    }
    if (database) await database.close();
  });

  async function putAlerts(body: Record<string, unknown>) {
    return app!.inject({
      method: 'PUT',
      url: '/api/v1/admin/monitoring/alerts',
      headers: { cookie: adminCookie, 'content-type': 'application/json' },
      payload: body,
    });
  }

  it('clears stored audit retention without dropping an alert threshold', async () => {
    const before = await readStoredOpsAlertSettings(database!);
    const marker = before?.diskFreeGbMin === 17 ? 18 : 17;

    const saved = await putAlerts({
      diskFreeGbMin: marker,
      auditRetentionDays: 30,
    });
    expect(saved.statusCode).toBe(200);
    const savedBody = saved.json() as AlertSettingsBody;
    expect(savedBody.settings.thresholds.diskFreeGbMin).toBe(marker);
    expect(savedBody.settings.audit.retentionDays).toBe(30);
    expect(savedBody.settings.audit.source).toBe('override');
    expect(savedBody.settings.source).toBe('override');

    const cleared = await putAlerts({ auditRetentionDays: null });
    expect(cleared.statusCode).toBe(200);
    const clearedBody = cleared.json() as AlertSettingsBody;
    expect(clearedBody.settings.thresholds.diskFreeGbMin).toBe(marker);
    expect(clearedBody.settings.audit.retentionDays).toBe(
      clearedBody.settings.env.auditRetentionDays,
    );
    expect(clearedBody.settings.audit.source).toBe('env');
    expect(clearedBody.settings.source).toBe('override');

    const stored = await readStoredOpsAlertSettings(database!);
    expect(stored?.diskFreeGbMin).toBe(marker);
    expect(stored?.auditRetentionDays).toBeUndefined();
    expect(stored?.diskFreeRatioMin).toBe(before?.diskFreeRatioMin);
    expect(stored?.staleAfterHours).toBe(before?.staleAfterHours);
    expect(stored?.offsiteStaleAfterHours).toBe(before?.offsiteStaleAfterHours);
    expect(stored?.errorSpikeThreshold).toBe(before?.errorSpikeThreshold);
    expect(stored?.errorSpikeWindowMinutes).toBe(before?.errorSpikeWindowMinutes);
    expect(stored?.webhookMode).toBe(before?.webhookMode);
    expect(stored?.webhookUrl).toBe(before?.webhookUrl);
    expect(stored?.recipients).toEqual(before?.recipients ?? {});
  });
});
