import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import { loadEnv } from '@project-knowledge-hub/config';
import { createDatabase } from '@project-knowledge-hub/database';
import { buildApp } from '../app.js';
import type { FastifyInstance } from 'fastify';

const hasIntegrationEnv =
  Boolean(process.env.DATABASE_URL) && Boolean(process.env.REDIS_URL);

describe.skipIf(!hasIntegrationEnv)('API health and readiness', () => {
  let app: FastifyInstance | undefined;
  let redis: Redis | undefined;
  let closeDatabase: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    const env = loadEnv({
      ...process.env,
      NODE_ENV: process.env.NODE_ENV ?? 'test',
      APP_ENV: process.env.APP_ENV ?? 'test',
      LOG_LEVEL: process.env.LOG_LEVEL ?? 'silent',
      SESSION_SECRET:
        process.env.SESSION_SECRET ?? 'test-session-secret-at-least-32-chars',
    });

    const database = createDatabase(env.DATABASE_URL);
    closeDatabase = () => database.close();

    redis = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      enableOfflineQueue: false,
      retryStrategy: () => null,
    });

    await redis.connect();
    await database.ping();

    app = await buildApp({ env, database, redis });
    await app.ready();
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

  it('GET /health returns ok', async () => {
    if (!app) {
      throw new Error('API app was not initialized');
    }
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { status: string; service: string };
    expect(body.status).toBe('ok');
    expect(body.service).toBe('project-knowledge-hub-api');
  });

  it('GET /ready verifies postgres and redis', async () => {
    if (!app) {
      throw new Error('API app was not initialized');
    }
    const response = await app.inject({ method: 'GET', url: '/ready' });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      status: string;
      checks: { postgres: string; redis: string };
    };
    expect(body.status).toBe('ready');
    expect(body.checks.postgres).toBe('ok');
    expect(body.checks.redis).toBe('ok');
  });
});
