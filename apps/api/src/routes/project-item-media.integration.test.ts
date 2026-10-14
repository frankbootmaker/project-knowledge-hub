import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { hashPassword } from '@project-knowledge-hub/auth';
import { loadEnv } from '@project-knowledge-hub/config';
import {
  createDatabase,
  memberships,
  organizations,
  platformSettings,
  users,
  workspaces,
  type Database,
} from '@project-knowledge-hub/database';
import { buildApp } from '../app.js';
import { MEDIA_MAX_BYTES_SETTING_KEY } from '../lib/media-max-bytes.js';
import type { FastifyInstance } from 'fastify';

const hasIntegrationEnv =
  Boolean(process.env.DATABASE_URL) && Boolean(process.env.REDIS_URL);

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

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

function pngUpload(filename: string): { body: Buffer; contentType: string } {
  const boundary = '----khmedia';
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: image/png\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    body: Buffer.concat([head, TINY_PNG, tail]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

type MediaLinkBody = {
  id: string;
  kind: 'media' | 'url';
  title: string | null;
  url: string | null;
  mediaId: string | null;
  deleted: boolean;
};

describe.skipIf(!hasIntegrationEnv)('item media links', () => {
  let app: FastifyInstance | undefined;
  let redis: Redis | undefined;
  let database: Database | undefined;
  let closeDatabase: (() => Promise<void>) | undefined;
  let adminCookie = '';
  let readerCookie = '';
  let workspaceId = '';
  let otherWorkspaceId = '';
  let projectId = '';
  const password = 'test-password-123';
  const origin = 'http://localhost:3100';
  let previousMediaLimit: string | null = null;
  let limitTouched = false;

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
    const [admin] = await database.db
      .insert(users)
      .values({
        email: `admin-media-${suffix}@example.com`,
        displayName: 'Admin',
        passwordHash: await hashPassword(password),
        isSystemAdmin: true,
        status: 'active',
      })
      .returning();
    const [reader] = await database.db
      .insert(users)
      .values({
        email: `reader-media-${suffix}@example.com`,
        displayName: 'Reader',
        passwordHash: await hashPassword(password),
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
    const [other] = await database.db
      .insert(workspaces)
      .values({
        organizationId: org?.id ?? '',
        name: `Other ${suffix}`,
        slug: `other-${suffix}`,
      })
      .returning();
    if (!org || !admin || !reader || !workspace || !other) {
      throw new Error('fixture missing');
    }
    workspaceId = workspace.id;
    otherWorkspaceId = other.id;
    await database.db.insert(memberships).values([
      {
        userId: admin.id,
        workspaceId: workspace.id,
        role: 'workspace_admin',
      },
      {
        userId: reader.id,
        workspaceId: workspace.id,
        role: 'reader',
      },
    ]);

    app = await buildApp({ env, database, redis });
    await app.ready();
    adminCookie = await login(admin.email);
    readerCookie = await login(reader.email);

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { cookie: adminCookie, origin },
      payload: { workspaceId, name: `Media ${suffix}` },
    });
    expect(created.statusCode).toBe(200);
    projectId = (created.json() as { project: { id: string } }).project.id;

    const [setting] = await database.db
      .select({ value: platformSettings.value })
      .from(platformSettings)
      .where(eq(platformSettings.key, MEDIA_MAX_BYTES_SETTING_KEY))
      .limit(1);
    previousMediaLimit = setting?.value ?? null;
  });

  afterAll(async () => {
    await restoreMediaLimit();
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

  async function login(email: string): Promise<string> {
    const env = testEnv();
    const response = await app!.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password },
    });
    const value = response.cookies.find(
      (cookie) => cookie.name === env.SESSION_COOKIE_NAME,
    )?.value;
    return `${env.SESSION_COOKIE_NAME}=${value}`;
  }

  async function restoreMediaLimit(): Promise<void> {
    if (!limitTouched || !database) return;
    if (previousMediaLimit == null) {
      await database.db
        .delete(platformSettings)
        .where(eq(platformSettings.key, MEDIA_MAX_BYTES_SETTING_KEY));
    } else {
      await database.db
        .update(platformSettings)
        .set({ value: previousMediaLimit })
        .where(eq(platformSettings.key, MEDIA_MAX_BYTES_SETTING_KEY));
    }
    limitTouched = false;
  }

  async function createTask(itemType?: 'bug'): Promise<string> {
    const response = await app!.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/tasks`,
      headers: { cookie: adminCookie, origin },
      payload: {
        title: itemType === 'bug' ? 'Media bug' : 'Media task',
        ...(itemType ? { itemType } : {}),
      },
    });
    expect(response.statusCode).toBe(200);
    return (response.json() as { task: { id: string; itemType: string } }).task.id;
  }

  async function uploadPng(targetWorkspaceId: string, filename: string): Promise<string> {
    const file = pngUpload(filename);
    const response = await app!.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${targetWorkspaceId}/media`,
      headers: {
        cookie: adminCookie,
        origin,
        'content-type': file.contentType,
      },
      payload: file.body,
    });
    expect(response.statusCode).toBe(200);
    return (response.json() as { media: { id: string } }).media.id;
  }

  async function putLinks(
    entityId: string,
    links: unknown[],
    cookie = adminCookie,
  ) {
    return app!.inject({
      method: 'PUT',
      url: `/api/v1/projects/${projectId}/item-media-links`,
      headers: { cookie, origin },
      payload: { entityType: 'task', entityId, links },
    });
  }

  it('links an image and a URL on a task, and a bug uses entity type task', async () => {
    const taskId = await createTask();
    const bugId = await createTask('bug');
    const mediaId = await uploadPng(workspaceId, 'linked.png');
    const spareId = await uploadPng(workspaceId, 'spare.png');

    const saved = await putLinks(taskId, [
      { kind: 'media', mediaId },
      {
        kind: 'url',
        url: 'https://example.com/notes',
        title: 'Notes',
      },
    ]);
    expect(saved.statusCode).toBe(200);
    const links = (saved.json() as { mediaLinks: MediaLinkBody[] }).mediaLinks;
    expect(links).toHaveLength(2);
    expect(links[0]).toMatchObject({ kind: 'media', mediaId, deleted: false });
    expect(links[0]?.url).toContain(`/api/v1/media/${mediaId}`);
    expect(links[1]).toMatchObject({
      kind: 'url',
      title: 'Notes',
      url: 'https://example.com/notes',
      deleted: false,
    });

    const task = await app!.inject({
      method: 'GET',
      url: `/api/v1/project-tasks/${taskId}`,
      headers: { cookie: adminCookie },
    });
    expect(task.statusCode).toBe(200);
    expect(
      (task.json() as { task: { mediaLinkCount: number } }).task.mediaLinkCount,
    ).toBe(2);

    const listed = await app!.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${workspaceId}/media?entityType=task&entityId=${taskId}`,
      headers: { cookie: adminCookie },
    });
    expect(listed.statusCode).toBe(200);
    const media = (
      listed.json() as {
        media: {
          id: string;
          createdByName: string | null;
          usedBy: { entityId: string; entityType: string }[];
        }[];
      }
    ).media;
    expect(media.map((row) => row.id)).toEqual([mediaId]);
    expect(media[0]?.usedBy).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ entityType: 'task', entityId: taskId }),
      ]),
    );
    expect(media[0]).toMatchObject({ createdByName: 'Admin' });
    expect(media.map((row) => row.id)).not.toContain(spareId);

    const bugSaved = await putLinks(bugId, [
      { kind: 'url', url: 'https://example.com/bug', title: 'Bug note' },
    ]);
    expect(bugSaved.statusCode).toBe(200);
    expect(
      (bugSaved.json() as { mediaLinks: MediaLinkBody[] }).mediaLinks[0]?.kind,
    ).toBe('url');

    const unlinked = await putLinks(taskId, []);
    expect(unlinked.statusCode).toBe(200);
    expect((unlinked.json() as { mediaLinks: MediaLinkBody[] }).mediaLinks).toEqual(
      [],
    );
    const library = await app!.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${workspaceId}/media?q=linked.png`,
      headers: { cookie: adminCookie },
    });
    expect(library.statusCode).toBe(200);
    expect(
      (library.json() as { media: { id: string }[] }).media.some(
        (row) => row.id === mediaId,
      ),
    ).toBe(true);
  });

  it('keeps a placeholder after the library image is archived', async () => {
    const taskId = await createTask();
    const mediaId = await uploadPng(workspaceId, 'archived.png');
    const linked = await putLinks(taskId, [{ kind: 'media', mediaId }]);
    expect(linked.statusCode).toBe(200);

    const removed = await app!.inject({
      method: 'DELETE',
      url: `/api/v1/media/${mediaId}`,
      headers: { cookie: adminCookie, origin },
    });
    expect(removed.statusCode).toBe(200);

    const listed = await app!.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/item-media-links?entityType=task&entityId=${taskId}`,
      headers: { cookie: adminCookie },
    });
    expect(listed.statusCode).toBe(200);
    const link = (listed.json() as { mediaLinks: MediaLinkBody[] }).mediaLinks[0];
    expect(link).toMatchObject({ kind: 'media', mediaId, deleted: true, url: null });

    const kept = await putLinks(taskId, [{ kind: 'media', mediaId }]);
    expect(kept.statusCode).toBe(200);
    expect(kept.json()).toMatchObject({
      mediaLinks: [{ mediaId, deleted: true, url: null }],
    });
  });

  it('rejects a non-http URL, a foreign-workspace image, and a reader write', async () => {
    const taskId = await createTask();
    const badUrl = await putLinks(taskId, [
      { kind: 'url', url: 'ftp://example.com/file', title: 'File' },
    ]);
    expect(badUrl.statusCode).toBe(400);
    expect((badUrl.json() as { error: { code: string } }).error.code).toBe(
      'INVALID_URL',
    );

    const foreignId = await uploadPng(otherWorkspaceId, 'foreign.png');
    const foreign = await putLinks(taskId, [{ kind: 'media', mediaId: foreignId }]);
    expect(foreign.statusCode).toBe(400);
    expect((foreign.json() as { error: { code: string } }).error.code).toBe(
      'ITEM_MEDIA_WORKSPACE_MISMATCH',
    );

    const reader = await putLinks(
      taskId,
      [{ kind: 'url', url: 'https://example.com/nope', title: 'Nope' }],
      readerCookie,
    );
    expect(reader.statusCode).toBe(403);
  });

  it('rejects an upload over the saved size limit and restores the previous limit', async () => {
    limitTouched = true;
    try {
      const saved = await app!.inject({
        method: 'PUT',
        url: '/api/v1/admin/media-library-settings',
        headers: { cookie: adminCookie, origin },
        payload: { maxBytes: 10 },
      });
      expect(saved.statusCode).toBe(200);
      expect((saved.json() as { settings: { maxBytes: number } }).settings.maxBytes).toBe(
        10,
      );

      const file = pngUpload('too-big.png');
      const upload = await app!.inject({
        method: 'POST',
        url: `/api/v1/workspaces/${workspaceId}/media`,
        headers: {
          cookie: adminCookie,
          origin,
          'content-type': file.contentType,
        },
        payload: file.body,
      });
      expect(upload.statusCode).toBe(400);
    } finally {
      await restoreMediaLimit();
    }

    const restored = await app!.inject({
      method: 'GET',
      url: '/api/v1/admin/media-library-settings',
      headers: { cookie: adminCookie },
    });
    expect(restored.statusCode).toBe(200);
    const settings = (restored.json() as { settings: { maxBytes: number } }).settings;
    const expected = previousMediaLimit == null
      ? settings.ceilingBytes
      : Math.min(Number(previousMediaLimit), settings.ceilingBytes);
    expect(settings.maxBytes).toBe(expected);
  });
});
