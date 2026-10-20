import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { hashPassword } from '@project-knowledge-hub/auth';
import { loadEnv } from '@project-knowledge-hub/config';
import {
  createDatabase,
  memberships,
  organizations,
  projectItemMediaLinks,
  projectTasks,
  projects,
  users,
  workspaceMedia,
  workspaces,
  type Database,
} from '@project-knowledge-hub/database';
import { buildApp } from '../app.js';
import { readMediaBytes, writeMediaBytes } from '../lib/workspace-media.js';
import type { FastifyInstance } from 'fastify';

const hasIntegrationEnv = Boolean(process.env.DATABASE_URL) && Boolean(process.env.REDIS_URL);

const repairSql = (() => {
  const file = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../packages/database/src/migrations/0075_repair_cross_workspace_item_media.sql',
  );
  const text = readFileSync(file, 'utf8');
  const match = text.match(/-- BEGIN REPAIR\r?\n([\s\S]*?)-- END REPAIR/);
  if (!match?.[1]) throw new Error(`repair SQL markers missing in ${file}`);
  return match[1];
})();

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

describe.skipIf(!hasIntegrationEnv)('Workspace purge and moved item media', () => {
  let app: FastifyInstance | undefined;
  let redis: Redis | undefined;
  let database: Database | undefined;
  let adminCookie = '';
  let adminId = '';
  let orgId = '';
  let uploadDir = '';
  const origin = 'http://localhost:3100';
  const password = 'test-password-123';

  beforeAll(async () => {
    const env = testEnv();
    uploadDir = env.MEDIA_UPLOAD_DIR;
    database = createDatabase(env.DATABASE_URL);
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
      .values({ name: `Purge Org ${suffix}`, slug: `purge-org-${suffix}` })
      .returning();
    const [admin] = await database.db
      .insert(users)
      .values({
        email: `purge-admin-${suffix}@example.com`,
        displayName: 'Purge Admin',
        passwordHash: await hashPassword(password),
        isSystemAdmin: true,
        status: 'active',
      })
      .returning();
    if (!org || !admin) throw new Error('fixtures missing');
    adminId = admin.id;
    orgId = org.id;

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
    if (database) await database.close();
  });

  async function makeWorkspace(name: string, archived = false) {
    const suffix = randomUUID();
    const [workspace] = await database!.db
      .insert(workspaces)
      .values({
        organizationId: orgId,
        name,
        slug: `purge-${suffix}`,
        archivedAt: archived ? new Date() : null,
      })
      .returning();
    if (!workspace) throw new Error('workspace missing');
    await database!.db.insert(memberships).values({
      userId: adminId,
      workspaceId: workspace.id,
      role: 'workspace_admin',
    });
    return workspace;
  }

  async function createProject(workspaceId: string, name: string, keyPrefix?: string) {
    const response = await app!.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { cookie: adminCookie, origin },
      payload: { workspaceId, name, ...(keyPrefix ? { keyPrefix } : {}) },
    });
    expect(response.statusCode).toBe(200);
    return (response.json() as { project: { id: string } }).project;
  }

  async function insertTask(projectId: string, issueNumber: number) {
    const [task] = await database!.db
      .insert(projectTasks)
      .values({
        projectId,
        title: `Task ${issueNumber}`,
        issueKeyType: 'T',
        issueNumber,
      })
      .returning();
    if (!task) throw new Error('task missing');
    return task;
  }

  async function insertMedia(workspaceId: string, bytes: Buffer) {
    const mediaId = randomUUID();
    await writeMediaBytes(uploadDir, workspaceId, mediaId, bytes, {
      contentType: 'image/png',
    });
    const [row] = await database!.db
      .insert(workspaceMedia)
      .values({
        id: mediaId,
        workspaceId,
        contentType: 'image/png',
        byteSize: bytes.byteLength,
        originalFilename: `${mediaId}.png`,
        createdBy: adminId,
      })
      .returning();
    if (!row) throw new Error('media missing');
    return row;
  }

  async function linkMedia(projectId: string, taskId: string, mediaId: string) {
    await database!.db.insert(projectItemMediaLinks).values({
      projectId,
      entityType: 'task',
      entityId: taskId,
      kind: 'media',
      workspaceMediaId: mediaId,
      createdBy: adminId,
    });
  }

  async function purge(workspaceId: string) {
    return app!.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${workspaceId}/purge`,
      headers: { cookie: adminCookie, origin },
      payload: { confirmDestroy: true },
    });
  }

  async function repair() {
    await database!.client.unsafe(repairSql);
  }

  it('moves task media with the project, then purges the source workspace', async () => {
    const source = await makeWorkspace(`Source ${randomUUID().slice(0, 8)}`);
    const dest = await makeWorkspace(`Dest ${randomUUID().slice(0, 8)}`);
    const moving = await createProject(source.id, `Move ${randomUUID().slice(0, 8)}`, 'MIL');
    const staying = await createProject(source.id, `Stay ${randomUUID().slice(0, 8)}`);
    const movingTask = await insertTask(moving.id, 53);
    const stayingTask = await insertTask(staying.id, 1);
    const exclusiveBytes = Buffer.from(`exclusive-${randomUUID()}`);
    const sharedBytes = Buffer.from(`shared-${randomUUID()}`);
    const exclusive = await insertMedia(source.id, exclusiveBytes);
    const shared = await insertMedia(source.id, sharedBytes);
    await linkMedia(moving.id, movingTask.id, exclusive.id);
    await linkMedia(moving.id, movingTask.id, shared.id);
    await linkMedia(staying.id, stayingTask.id, shared.id);

    const moved = await app!.inject({
      method: 'POST',
      url: `/api/v1/projects/${moving.id}/move`,
      headers: { cookie: adminCookie, origin },
      payload: { targetWorkspaceId: dest.id },
    });
    expect(moved.statusCode).toBe(200);
    const counts = (
      moved.json() as { move: { counts: { mediaMoved: number; mediaDuplicated: number } } }
    ).move.counts;
    expect(counts.mediaMoved).toBe(1);
    expect(counts.mediaDuplicated).toBe(1);

    const [exclusiveRow] = await database!.db
      .select()
      .from(workspaceMedia)
      .where(eq(workspaceMedia.id, exclusive.id));
    expect(exclusiveRow?.workspaceId).toBe(dest.id);
    expect(exclusiveRow?.storageWorkspaceId).toBeNull();
    const exclusiveRead = await readMediaBytes(uploadDir, dest.id, exclusive.id);
    expect(exclusiveRead?.equals(exclusiveBytes)).toBe(true);
    expect(await readMediaBytes(uploadDir, source.id, exclusive.id)).toBeNull();

    const sharedLinks = await database!.db
      .select()
      .from(projectItemMediaLinks)
      .where(eq(projectItemMediaLinks.entityId, movingTask.id));
    const movingSharedLink = sharedLinks.find((row) => row.workspaceMediaId !== exclusive.id);
    expect(movingSharedLink?.workspaceMediaId).toBeTruthy();
    expect(movingSharedLink?.workspaceMediaId).not.toBe(shared.id);
    const [copy] = await database!.db
      .select()
      .from(workspaceMedia)
      .where(eq(workspaceMedia.id, movingSharedLink!.workspaceMediaId!));
    expect(copy?.workspaceId).toBe(dest.id);
    const [original] = await database!.db
      .select()
      .from(workspaceMedia)
      .where(eq(workspaceMedia.id, shared.id));
    expect(original?.workspaceId).toBe(source.id);
    const stayingLinks = await database!.db
      .select()
      .from(projectItemMediaLinks)
      .where(eq(projectItemMediaLinks.entityId, stayingTask.id));
    expect(stayingLinks[0]?.workspaceMediaId).toBe(shared.id);
    expect((await readMediaBytes(uploadDir, source.id, shared.id))?.equals(sharedBytes)).toBe(true);
    expect((await readMediaBytes(uploadDir, dest.id, copy!.id))?.equals(sharedBytes)).toBe(true);

    const purged = await purge(source.id);
    expect(purged.statusCode).toBe(204);
    const [stillThere] = await database!.db
      .select()
      .from(workspaceMedia)
      .where(eq(workspaceMedia.id, exclusive.id));
    expect(stillThere?.workspaceId).toBe(dest.id);
    expect((await readMediaBytes(uploadDir, dest.id, exclusive.id))?.equals(exclusiveBytes)).toBe(
      true,
    );
    expect((await readMediaBytes(uploadDir, dest.id, copy!.id))?.equals(sharedBytes)).toBe(true);
  });

  it('returns 409 for a cross-workspace attachment, then the migration repairs it', async () => {
    const source = await makeWorkspace('bootdave');
    const dest = await makeWorkspace('MileGuide');
    const [project] = await database!.db
      .insert(projects)
      .values({
        workspaceId: dest.id,
        name: 'MileGuide',
        slug: `mileguide-${randomUUID()}`,
        keyPrefix: 'MIL',
      })
      .returning();
    if (!project) throw new Error('project missing');
    const task = await insertTask(project.id, 53);
    const first = Buffer.from(`png-a-${randomUUID()}`);
    const second = Buffer.from(`png-b-${randomUUID()}`);
    const mediaA = await insertMedia(source.id, first);
    const mediaB = await insertMedia(source.id, second);
    await linkMedia(project.id, task.id, mediaA.id);
    await linkMedia(project.id, task.id, mediaB.id);

    const blocked = await purge(source.id);
    expect(blocked.statusCode).toBe(409);
    const body = blocked.json() as {
      error: {
        code: string;
        message: string;
        details: {
          blockers: Array<{
            count: number;
            itemKey: string | null;
            workspaceName: string;
            entityId: string;
          }>;
        };
      };
    };
    expect(body.error.code).toBe('WORKSPACE_PURGE_BLOCKED');
    expect(body.error.message).toBe('2 media files used by MIL-T-53 in workspace MileGuide');
    expect(body.error.details.blockers).toEqual([
      expect.objectContaining({
        kind: 'item_media',
        count: 2,
        itemKey: 'MIL-T-53',
        entityId: task.id,
        workspaceName: 'MileGuide',
      }),
    ]);
    const [untouched] = await database!.db
      .select({ id: workspaceMedia.id })
      .from(workspaceMedia)
      .where(eq(workspaceMedia.id, mediaA.id));
    expect(untouched?.id).toBe(mediaA.id);

    await repair();
    for (const media of [mediaA, mediaB]) {
      const [row] = await database!.db
        .select()
        .from(workspaceMedia)
        .where(eq(workspaceMedia.id, media.id));
      expect(row?.workspaceId).toBe(dest.id);
      expect(row?.storageWorkspaceId).toBe(source.id);
      expect(row?.storageMediaId).toBe(media.id);
    }
    const links = await database!.db
      .select()
      .from(projectItemMediaLinks)
      .where(eq(projectItemMediaLinks.entityId, task.id));
    expect(links.map((row) => row.workspaceMediaId).sort()).toEqual([mediaA.id, mediaB.id].sort());

    const viewed = await app!.inject({
      method: 'GET',
      url: `/api/v1/media/${mediaA.id}`,
      headers: { cookie: adminCookie },
    });
    expect(viewed.statusCode).toBe(200);
    expect(viewed.rawPayload.equals(first)).toBe(true);

    await repair();
    const copies = await database!.db
      .select({ id: workspaceMedia.id })
      .from(workspaceMedia)
      .where(eq(workspaceMedia.workspaceId, dest.id));
    const repairedIds = copies.filter((row) => row.id === mediaA.id || row.id === mediaB.id);
    expect(repairedIds).toHaveLength(2);

    const purged = await purge(source.id);
    expect(purged.statusCode).toBe(204);
    const stillViewable = await app!.inject({
      method: 'GET',
      url: `/api/v1/media/${mediaA.id}`,
      headers: { cookie: adminCookie },
    });
    expect(stillViewable.statusCode).toBe(200);
    expect(stillViewable.rawPayload.equals(first)).toBe(true);
  });

  it('copies a shared cross-workspace link and leaves the original media row', async () => {
    const source = await makeWorkspace(`Shared source ${randomUUID().slice(0, 8)}`);
    const dest = await makeWorkspace(`Shared dest ${randomUUID().slice(0, 8)}`);
    const [home] = await database!.db
      .insert(projects)
      .values({
        workspaceId: source.id,
        name: 'Home',
        slug: `home-${randomUUID()}`,
        keyPrefix: 'HOM',
      })
      .returning();
    const [away] = await database!.db
      .insert(projects)
      .values({
        workspaceId: dest.id,
        name: 'Away',
        slug: `away-${randomUUID()}`,
        keyPrefix: 'AWY',
      })
      .returning();
    if (!home || !away) throw new Error('projects missing');
    const homeTask = await insertTask(home.id, 1);
    const awayTask = await insertTask(away.id, 2);
    const bytes = Buffer.from(`shared-repair-${randomUUID()}`);
    const media = await insertMedia(source.id, bytes);
    await linkMedia(home.id, homeTask.id, media.id);
    await linkMedia(away.id, awayTask.id, media.id);

    await repair();
    await repair();

    const [original] = await database!.db
      .select()
      .from(workspaceMedia)
      .where(eq(workspaceMedia.id, media.id));
    expect(original?.workspaceId).toBe(source.id);
    const [homeLink] = await database!.db
      .select()
      .from(projectItemMediaLinks)
      .where(eq(projectItemMediaLinks.entityId, homeTask.id));
    const [awayLink] = await database!.db
      .select()
      .from(projectItemMediaLinks)
      .where(eq(projectItemMediaLinks.entityId, awayTask.id));
    expect(homeLink?.workspaceMediaId).toBe(media.id);
    expect(awayLink?.workspaceMediaId).toBeTruthy();
    expect(awayLink?.workspaceMediaId).not.toBe(media.id);
    const [copy] = await database!.db
      .select()
      .from(workspaceMedia)
      .where(eq(workspaceMedia.id, awayLink!.workspaceMediaId!));
    expect(copy?.workspaceId).toBe(dest.id);
    expect(copy?.storageWorkspaceId).toBe(source.id);
    expect(copy?.storageMediaId).toBe(media.id);
    const viewed = await app!.inject({
      method: 'GET',
      url: `/api/v1/media/${copy!.id}`,
      headers: { cookie: adminCookie },
    });
    expect(viewed.statusCode).toBe(200);
    expect(viewed.rawPayload.equals(bytes)).toBe(true);

    const rows = await database!.db
      .select({ id: workspaceMedia.id })
      .from(workspaceMedia)
      .where(eq(workspaceMedia.storageMediaId, media.id));
    expect(rows).toHaveLength(1);
  });

  it('purges an empty workspace and an archived workspace that only holds its own media', async () => {
    const empty = await makeWorkspace(`Empty ${randomUUID().slice(0, 8)}`);
    const emptied = await purge(empty.id);
    expect(emptied.statusCode).toBe(204);

    const archived = await makeWorkspace(`Archived ${randomUUID().slice(0, 8)}`, true);
    const [project] = await database!.db
      .insert(projects)
      .values({
        workspaceId: archived.id,
        name: 'Old',
        slug: `old-${randomUUID()}`,
        keyPrefix: 'OLD',
        archivedAt: new Date(),
      })
      .returning();
    if (!project) throw new Error('archived project missing');
    const task = await insertTask(project.id, 3);
    const media = await insertMedia(archived.id, Buffer.from('archived-png'));
    await linkMedia(project.id, task.id, media.id);

    const purged = await purge(archived.id);
    expect(purged.statusCode).toBe(204);
    const [gone] = await database!.db
      .select({ id: workspaceMedia.id })
      .from(workspaceMedia)
      .where(eq(workspaceMedia.id, media.id));
    expect(gone).toBeUndefined();
  });
});
