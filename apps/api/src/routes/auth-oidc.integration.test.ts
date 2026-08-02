import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import { loadEnv } from '@project-knowledge-hub/config';
import { createDatabase } from '@project-knowledge-hub/database';
import { buildApp } from '../app.js';
import type { FastifyInstance } from 'fastify';

const hasIntegrationEnv =
  Boolean(process.env.DATABASE_URL) && Boolean(process.env.REDIS_URL);

function testEnv(overrides: Record<string, string | undefined> = {}) {
  return loadEnv({
    ...process.env,
    ...overrides,
    NODE_ENV: 'test',
    APP_ENV: 'test',
    LOG_LEVEL: 'silent',
    SESSION_SECRET:
      process.env.SESSION_SECRET ?? 'test-session-secret-at-least-32-chars',
    WEB_URL: process.env.WEB_URL ?? 'http://localhost:3100',
  });
}

describe.skipIf(!hasIntegrationEnv)('OIDC auth routes (disabled)', () => {
  let app: FastifyInstance | undefined;
  let redis: Redis | undefined;
  let closeDatabase: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    const env = testEnv({
      OIDC_ISSUER: '',
      OIDC_CLIENT_ID: '',
      OIDC_CLIENT_SECRET: '',
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
    app = await buildApp({ env, database, redis });
  });

  afterAll(async () => {
    await app?.close();
    await redis?.quit();
    await closeDatabase?.();
  });

  it('reports OIDC disabled when env unset', async () => {
    const response = await app!.inject({
      method: 'GET',
      url: '/api/v1/auth/oidc/status',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ enabled: false });
  });

  it('returns 404 for start when OIDC disabled', async () => {
    const response = await app!.inject({
      method: 'GET',
      url: '/api/v1/auth/oidc/start',
    });
    expect(response.statusCode).toBe(404);
  });

  it('redirects callback without state to login error', async () => {
    const response = await app!.inject({
      method: 'GET',
      url: '/api/v1/auth/oidc/callback',
    });
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toContain('/login?sso=error');
  });
});
