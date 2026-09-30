import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { hashPassword } from '@project-knowledge-hub/auth';
import { loadEnv } from '@project-knowledge-hub/config';
import {
  auditEvents,
  createDatabase,
  embeddingModels,
  knowledgeRecordChunks,
  knowledgeRecords,
  memberships,
  organizations,
  projectTags,
  projects,
  systems,
  tags,
  users,
  workspaces,
  type Database,
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

describe.skipIf(!hasIntegrationEnv)('Project workspace move', () => {
  let app: FastifyInstance | undefined;
  let redis: Redis | undefined;
  let database: Database | undefined;
  let adminCookie = '';
  let adminId = '';
  let sourceWorkspaceId = '';
  let destWorkspaceId = '';
  let otherOrgWorkspaceId = '';
  let sourceOrgId = '';
  let otherOrgId = '';
  const password = 'test-password-123';
  const origin = 'http://localhost:3100';

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

    const suffix = randomUUID();
    const [org] = await database.db
      .insert(organizations)
      .values({ name: `Move Org ${suffix}`, slug: `move-org-${suffix}` })
      .returning();
    const [otherOrg] = await database.db
      .insert(organizations)
      .values({ name: `Other Org ${suffix}`, slug: `other-org-${suffix}` })
      .returning();
    const [admin] = await database.db
      .insert(users)
      .values({
        email: `move-admin-${suffix}@example.com`,
        displayName: 'Move Admin',
        passwordHash: await hashPassword(password),
        isSystemAdmin: true,
        status: 'active',
      })
      .returning();
    if (!org || !otherOrg || !admin) throw new Error('fixtures missing');
    adminId = admin.id;
    sourceOrgId = org.id;
    otherOrgId = otherOrg.id;

    const [source] = await database.db
      .insert(workspaces)
      .values({
        organizationId: org.id,
        name: `Source ${suffix}`,
        slug: `move-src-${suffix}`,
      })
      .returning();
    const [dest] = await database.db
      .insert(workspaces)
      .values({
        organizationId: org.id,
        name: `Dest ${suffix}`,
        slug: `move-dst-${suffix}`,
      })
      .returning();
    const [other] = await database.db
      .insert(workspaces)
      .values({
        organizationId: otherOrg.id,
        name: `Other ${suffix}`,
        slug: `move-other-${suffix}`,
      })
      .returning();
    if (!source || !dest || !other) throw new Error('workspaces missing');
    sourceWorkspaceId = source.id;
    destWorkspaceId = dest.id;
    otherOrgWorkspaceId = other.id;

    await database.db.insert(memberships).values([
      { userId: admin.id, workspaceId: source.id, role: 'workspace_admin' },
      { userId: admin.id, workspaceId: dest.id, role: 'workspace_admin' },
      { userId: admin.id, workspaceId: other.id, role: 'workspace_admin' },
    ]);

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

  async function createProject(workspaceId: string, name: string, extra: Record<string, unknown> = {}) {
    const response = await app!.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { cookie: adminCookie, origin },
      payload: { workspaceId, name, tags: ['alpha'], ...extra },
    });
    expect(response.statusCode).toBe(200);
    return response.json() as {
      project: { id: string; slug: string; workspaceId: string; tags: Array<{ id: string; slug: string }> };
    };
  }

  it('moves a project inside an organization and leaves a dry run unchanged', async () => {
    const created = await createProject(sourceWorkspaceId, `Move Me ${randomUUID().slice(0, 8)}`);
    const system = await app!.inject({
      method: 'POST',
      url: '/api/v1/systems',
      headers: { cookie: adminCookie, origin },
      payload: {
        workspaceId: sourceWorkspaceId,
        projectId: created.project.id,
        name: `Linked ${created.project.slug}`,
        status: 'active',
      },
    });
    expect(system.statusCode).toBe(200);
    const systemId = (system.json() as { system: { id: string } }).system.id;

    const record = await app!.inject({
      method: 'POST',
      url: '/api/v1/knowledge-records',
      headers: { cookie: adminCookie, origin },
      payload: {
        workspaceId: sourceWorkspaceId,
        projectId: created.project.id,
        title: 'Move note',
        recordType: 'note',
        contentMarkdown: 'hello',
      },
    });
    expect(record.statusCode).toBe(200);
    const recordId = (record.json() as { knowledgeRecord: { id: string } }).knowledgeRecord.id;

    const [model] = await database!.db
      .insert(embeddingModels)
      .values({
        provider: 'test',
        modelName: `move-${randomUUID()}`,
        dimensions: 768,
      })
      .returning();
    if (!model) throw new Error('embedding model missing');
    const [chunk] = await database!.db
      .insert(knowledgeRecordChunks)
      .values({
        knowledgeRecordId: recordId,
        workspaceId: sourceWorkspaceId,
        chunkIndex: 0,
        content: 'hello',
        embeddingModelId: model.id,
        embedding: Array.from({ length: 768 }, () => 0),
        contentHash: 'move-test',
      })
      .returning();

    const dryRun = await app!.inject({
      method: 'POST',
      url: `/api/v1/projects/${created.project.id}/move`,
      headers: { cookie: adminCookie, origin },
      payload: { targetWorkspaceId: destWorkspaceId, dryRun: true },
    });
    expect(dryRun.statusCode).toBe(200);
    const dryBody = dryRun.json() as { move: { dryRun: boolean; conflicts: unknown[] } };
    expect(dryBody.move.dryRun).toBe(true);
    expect(dryBody.move.conflicts).toEqual([]);
    const [stillSource] = await database!.db
      .select({ workspaceId: projects.workspaceId })
      .from(projects)
      .where(eq(projects.id, created.project.id));
    expect(stillSource?.workspaceId).toBe(sourceWorkspaceId);

    const moved = await app!.inject({
      method: 'POST',
      url: `/api/v1/projects/${created.project.id}/move`,
      headers: { cookie: adminCookie, origin },
      payload: { targetWorkspaceId: destWorkspaceId },
    });
    expect(moved.statusCode).toBe(200);
    const movedBody = moved.json() as {
      move: { crossOrganization: boolean; project: { workspaceId: string } };
    };
    expect(movedBody.move.crossOrganization).toBe(false);
    expect(movedBody.move.project.workspaceId).toBe(destWorkspaceId);

    const [systemRow] = await database!.db
      .select({ workspaceId: systems.workspaceId })
      .from(systems)
      .where(eq(systems.id, systemId));
    const [recordRow] = await database!.db
      .select({ workspaceId: knowledgeRecords.workspaceId })
      .from(knowledgeRecords)
      .where(eq(knowledgeRecords.id, recordId));
    const [chunkRow] = await database!.db
      .select({ workspaceId: knowledgeRecordChunks.workspaceId })
      .from(knowledgeRecordChunks)
      .where(eq(knowledgeRecordChunks.id, chunk!.id));
    expect(systemRow?.workspaceId).toBe(destWorkspaceId);
    expect(recordRow?.workspaceId).toBe(destWorkspaceId);
    expect(chunkRow?.workspaceId).toBe(destWorkspaceId);

    const tagLinks = await database!.db
      .select({ tagId: projectTags.tagId })
      .from(projectTags)
      .where(eq(projectTags.projectId, created.project.id));
    expect(tagLinks.map((row) => row.tagId)).toEqual(
      created.project.tags.filter((tag) => tag.slug === 'alpha').map((tag) => tag.id),
    );
  });

  it('blocks a slug collision and a shared system', async () => {
    const name = `Clash ${randomUUID().slice(0, 8)}`;
    const sourceProject = await createProject(sourceWorkspaceId, name);
    await createProject(destWorkspaceId, name);
    const blocked = await app!.inject({
      method: 'POST',
      url: `/api/v1/projects/${sourceProject.project.id}/move`,
      headers: { cookie: adminCookie, origin },
      payload: { targetWorkspaceId: destWorkspaceId },
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toMatchObject({ error: { code: 'PROJECT_MOVE_BLOCKED' } });

    const owned = await createProject(sourceWorkspaceId, `Owned ${randomUUID().slice(0, 8)}`);
    const linked = await app!.inject({
      method: 'POST',
      url: '/api/v1/systems',
      headers: { cookie: adminCookie, origin },
      payload: {
        workspaceId: sourceWorkspaceId,
        projectId: owned.project.id,
        name: `Shared system ${owned.project.slug}`,
        status: 'active',
      },
    });
    const systemId = (linked.json() as { system: { id: string } }).system.id;
    const outside = await app!.inject({
      method: 'POST',
      url: '/api/v1/knowledge-records',
      headers: { cookie: adminCookie, origin },
      payload: {
        workspaceId: sourceWorkspaceId,
        systemId,
        title: 'Outside the project',
        recordType: 'note',
      },
    });
    expect(outside.statusCode).toBe(200);
    const shared = await app!.inject({
      method: 'POST',
      url: `/api/v1/projects/${owned.project.id}/move`,
      headers: { cookie: adminCookie, origin },
      payload: { targetWorkspaceId: destWorkspaceId },
    });
    expect(shared.statusCode).toBe(409);
    const sharedBody = shared.json() as {
      error: { details: { conflicts: Array<{ type: string }> } };
    };
    expect(sharedBody.error.details.conflicts.some((item) => item.type === 'shared_system')).toBe(
      true,
    );
  });

  it('requires confirmation before a cross-organization move, then remaps tags and copies audit', async () => {
    const created = await createProject(
      sourceWorkspaceId,
      `Cross ${randomUUID().slice(0, 8)}`,
    );
    const sourceTagId = created.project.tags.find((tag) => tag.slug === 'alpha')?.id;
    expect(sourceTagId).toBeTruthy();

    const unconfirmed = await app!.inject({
      method: 'POST',
      url: `/api/v1/projects/${created.project.id}/move`,
      headers: { cookie: adminCookie, origin },
      payload: { targetWorkspaceId: otherOrgWorkspaceId },
    });
    expect(unconfirmed.statusCode).toBe(400);
    expect(unconfirmed.json()).toMatchObject({
      error: { code: 'PROJECT_MOVE_CONFIRM_REQUIRED' },
    });
    const [notYet] = await database!.db
      .select({ workspaceId: projects.workspaceId })
      .from(projects)
      .where(eq(projects.id, created.project.id));
    expect(notYet?.workspaceId).toBe(sourceWorkspaceId);

    const confirmed = await app!.inject({
      method: 'POST',
      url: `/api/v1/projects/${created.project.id}/move`,
      headers: { cookie: adminCookie, origin },
      payload: { targetWorkspaceId: otherOrgWorkspaceId, confirmCrossOrganization: true },
    });
    expect(confirmed.statusCode).toBe(200);

    const [sourceTag] = await database!.db
      .select()
      .from(tags)
      .where(eq(tags.id, sourceTagId!));
    expect(sourceTag?.organizationId).toBe(sourceOrgId);

    const links = await database!.db
      .select({ tagId: projectTags.tagId })
      .from(projectTags)
      .where(eq(projectTags.projectId, created.project.id));
    expect(links).toHaveLength(1);
    expect(links[0]?.tagId).not.toBe(sourceTagId);
    const [destTag] = await database!.db
      .select()
      .from(tags)
      .where(eq(tags.id, links[0]!.tagId));
    expect(destTag?.organizationId).toBe(otherOrgId);
    expect(destTag?.slug).toBe('alpha');

    const sourceAudit = await database!.db
      .select({ id: auditEvents.id })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organizationId, sourceOrgId),
          eq(auditEvents.entityId, created.project.id),
          eq(auditEvents.action, 'project.create'),
        ),
      );
    const destAudit = await database!.db
      .select({ id: auditEvents.id })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organizationId, otherOrgId),
          eq(auditEvents.entityId, created.project.id),
          eq(auditEvents.action, 'project.create'),
        ),
      );
    expect(sourceAudit.length).toBeGreaterThan(0);
    expect(destAudit.length).toBeGreaterThan(0);
  });

  it('blocks the move when an assigned person is not a destination member', async () => {
    const [lonely] = await database!.db
      .insert(workspaces)
      .values({
        organizationId: sourceOrgId,
        name: `Lonely ${randomUUID().slice(0, 8)}`,
        slug: `lonely-${randomUUID()}`,
      })
      .returning();
    if (!lonely) throw new Error('lonely workspace missing');
    const created = await createProject(sourceWorkspaceId, `Member ${randomUUID().slice(0, 8)}`);
    await database!.db
      .update(projects)
      .set({ ownerUserId: adminId })
      .where(eq(projects.id, created.project.id));
    await database!.db
      .delete(memberships)
      .where(and(eq(memberships.userId, adminId), eq(memberships.workspaceId, lonely.id)));

    const blocked = await app!.inject({
      method: 'POST',
      url: `/api/v1/projects/${created.project.id}/move`,
      headers: { cookie: adminCookie, origin },
      payload: { targetWorkspaceId: lonely.id },
    });
    expect(blocked.statusCode).toBe(409);
    const body = blocked.json() as {
      error: { details: { conflicts: Array<{ type: string }> } };
    };
    expect(body.error.details.conflicts.some((item) => item.type === 'membership')).toBe(true);
  });
});
