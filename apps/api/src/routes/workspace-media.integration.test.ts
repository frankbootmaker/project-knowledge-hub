import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { loadEnv } from '@project-knowledge-hub/config';
import { createDatabase } from '@project-knowledge-hub/database';
import { buildApp } from '../app.js';
import type { FastifyInstance } from 'fastify';
import { createWorkspaceMedia } from '../lib/workspace-media.js';

const hasIntegrationEnv =
  Boolean(process.env.DATABASE_URL) && Boolean(process.env.REDIS_URL);

describe.skipIf(!hasIntegrationEnv)('Workspace media routes', () => {
  let app: FastifyInstance | undefined;
  let redis: Redis | undefined;
  let closeDatabase: (() => Promise<void>) | undefined;
  let authToken: string | undefined;
  let workspaceId: string | undefined;
  let organizationId: string | undefined;
  let userId: string | undefined;

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

    organizationId = randomUUID();
    userId = randomUUID();
    workspaceId = randomUUID();

    await database.db.execute(
      `INSERT INTO organizations (id, name, slug) VALUES ('${organizationId}', 'Test Org', 'test-org')`,
    );
    await database.db.execute(
      `INSERT INTO users (id, email, username, password_hash) VALUES ('${userId}', 'test@example.com', 'testuser', 'hash')`,
    );
    await database.db.execute(
      `INSERT INTO workspaces (id, organization_id, name, slug) VALUES ('${workspaceId}', '${organizationId}', 'Test Workspace', 'test-ws')`,
    );
    await database.db.execute(
      `INSERT INTO memberships (organization_id, user_id, role) VALUES ('${organizationId}', '${userId}', 'owner')`,
    );
    await database.db.execute(
      `INSERT INTO workspace_access (workspace_id, user_id, role) VALUES ('${workspaceId}', '${userId}', 'maintainer')`,
    );

    const sessionResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/sessions',
      payload: { email: 'test@example.com', password: 'hash' },
    });
    const sessionBody = sessionResponse.json() as { token?: string };
    authToken = sessionBody.token;
  });

  afterAll(async () => {
    if (workspaceId && userId && organizationId && app) {
      await app.database.db.execute(
        `DELETE FROM workspace_access WHERE workspace_id = '${workspaceId}'`,
      );
      await app.database.db.execute(
        `DELETE FROM workspaces WHERE id = '${workspaceId}'`,
      );
      await app.database.db.execute(
        `DELETE FROM memberships WHERE organization_id = '${organizationId}'`,
      );
      await app.database.db.execute(`DELETE FROM users WHERE id = '${userId}'`);
      await app.database.db.execute(
        `DELETE FROM organizations WHERE id = '${organizationId}'`,
      );
    }
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

  it('GET /api/v1/media/:mediaId sends X-Content-Type-Options: nosniff', async () => {
    if (!app || !authToken || !workspaceId) {
      throw new Error('Test environment not initialized');
    }

    const pngBuffer = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      0x49, 0x48, 0x44, 0x52,
    ]);

    const { store: blobStore } = await app.getBlobStore();
    const media = await createWorkspaceMedia(app.database, {
      workspaceId,
      contentType: 'image/png',
      buffer: pngBuffer,
      uploadDir: app.env.MEDIA_UPLOAD_DIR,
      maxBytes: app.env.MEDIA_MAX_BYTES,
      blobStore,
      createdBy: userId,
    });

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/media/${media.id}`,
      headers: {
        authorization: `Bearer ${authToken}`,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('image/png');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['cache-control']).toContain('private');
  });

  it('rejects plain text uploaded with contentType image/png', async () => {
    if (!app || !authToken || !workspaceId) {
      throw new Error('Test environment not initialized');
    }

    const textBuffer = Buffer.from('This is plain text, not a PNG', 'utf8');

    const { store: blobStore } = await app.getBlobStore();

    await expect(
      createWorkspaceMedia(app.database, {
        workspaceId,
        contentType: 'image/png',
        buffer: textBuffer,
        uploadDir: app.env.MEDIA_UPLOAD_DIR,
        maxBytes: app.env.MEDIA_MAX_BYTES,
        blobStore,
        createdBy: userId,
      }),
    ).rejects.toMatchObject({
      code: 'MEDIA_CONTENT_MISMATCH',
      statusCode: 400,
    });
  });

  it('rejects HTML uploaded with contentType image/jpeg', async () => {
    if (!app || !authToken || !workspaceId) {
      throw new Error('Test environment not initialized');
    }

    const htmlBuffer = Buffer.from(
      '<html><body>Not an image</body></html>',
      'utf8',
    );

    const { store: blobStore } = await app.getBlobStore();

    await expect(
      createWorkspaceMedia(app.database, {
        workspaceId,
        contentType: 'image/jpeg',
        buffer: htmlBuffer,
        uploadDir: app.env.MEDIA_UPLOAD_DIR,
        maxBytes: app.env.MEDIA_MAX_BYTES,
        blobStore,
        createdBy: userId,
      }),
    ).rejects.toMatchObject({
      code: 'MEDIA_CONTENT_MISMATCH',
      statusCode: 400,
    });
  });
});
