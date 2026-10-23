import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { loadEnv } from '@project-knowledge-hub/config';
import {
  createDatabase,
  organizations,
  projects,
  users,
  workspaces,
  type Database,
} from '@project-knowledge-hub/database';
import { AppError } from '@project-knowledge-hub/domain';
import {
  assertUniqueProjectSlug,
  listSlugMatches,
  releaseProjectSlug,
  resolveProjectSlug,
  retireProjectSlug,
} from './project-slugs.js';

const hasTestDb = Boolean(process.env.DATABASE_URL);

function testEnv() {
  return loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    APP_ENV: 'test',
    LOG_LEVEL: 'silent',
    SESSION_SECRET:
      process.env.SESSION_SECRET ?? 'test-session-secret-at-least-32-chars',
  });
}

describe.skipIf(!hasTestDb)('PRO-T-128 project slug history', () => {
  let database: Database;
  let closeDatabase: () => Promise<void>;

  beforeEach(() => {
    const env = testEnv();
    database = createDatabase(env.DATABASE_URL);
    closeDatabase = () => database.close();
  });

  afterEach(async () => {
    await closeDatabase();
  });

  it('reserves the old slug, redirects it, and frees it on release', async () => {
    const suffix = randomUUID().slice(0, 8);
    const [org] = await database.db
      .insert(organizations)
      .values({ name: `Slug ${suffix}`, slug: `slug-org-${suffix}` })
      .returning();
    const [author] = await database.db
      .insert(users)
      .values({
        email: `slug-${suffix}@example.com`,
        displayName: 'Slug author',
        status: 'active',
      })
      .returning();
    const [workspace] = await database.db
      .insert(workspaces)
      .values({
        organizationId: org!.id,
        name: `Workspace ${suffix}`,
        slug: `ws-${suffix}`,
      })
      .returning();
    const [project] = await database.db
      .insert(projects)
      .values({
        workspaceId: workspace!.id,
        name: 'RelayHorizon',
        slug: 'outpost',
        status: 'active',
      })
      .returning();

    const changed = await retireProjectSlug(database.db, {
      projectId: project!.id,
      workspaceId: workspace!.id,
      previousSlug: 'outpost',
      nextSlug: 'relayhorizon',
      actorUserId: author!.id,
    });
    expect(changed).toBe(true);
    await database.db
      .update(projects)
      .set({ slug: 'relayhorizon' })
      .where(eq(projects.id, project!.id));

    const resolved = await resolveProjectSlug(database, {
      workspaceId: workspace!.id,
      slug: 'outpost',
    });
    expect(resolved.redirect).toBe(true);
    expect(resolved.project.slug).toBe('relayhorizon');

    const current = await resolveProjectSlug(database, {
      workspaceId: workspace!.id,
      slug: 'relayhorizon',
    });
    expect(current.redirect).toBe(false);

    await expect(
      assertUniqueProjectSlug(database, {
        workspaceId: workspace!.id,
        slug: 'outpost',
      }),
    ).rejects.toMatchObject({ code: 'PROJECT_SLUG_CONFLICT' });

    await releaseProjectSlug(database, {
      projectId: project!.id,
      slug: 'outpost',
      actorUserId: author!.id,
    });
    await expect(
      resolveProjectSlug(database, {
        workspaceId: workspace!.id,
        slug: 'outpost',
      }),
    ).rejects.toMatchObject({ code: 'PROJECT_NOT_FOUND' });
    await expect(
      assertUniqueProjectSlug(database, {
        workspaceId: workspace!.id,
        slug: 'outpost',
      }),
    ).resolves.toBe('outpost');
  });

  it('rejects the reserved create-page slug', async () => {
    const suffix = randomUUID().slice(0, 8);
    const [org] = await database.db
      .insert(organizations)
      .values({ name: `Reserved ${suffix}`, slug: `reserved-${suffix}` })
      .returning();
    const [workspace] = await database.db
      .insert(workspaces)
      .values({
        organizationId: org!.id,
        name: `Workspace ${suffix}`,
        slug: `ws-new-${suffix}`,
      })
      .returning();
    await expect(
      assertUniqueProjectSlug(database, {
        workspaceId: workspace!.id,
        slug: 'new',
      }),
    ).rejects.toBeInstanceOf(AppError);
    await expect(
      assertUniqueProjectSlug(database, {
        workspaceId: workspace!.id,
        slug: 'new',
      }),
    ).rejects.toMatchObject({ code: 'PROJECT_SLUG_RESERVED' });
  });

  it('treats the same slug in another workspace as a separate match', async () => {
    const suffix = randomUUID().slice(0, 8);
    const [org] = await database.db
      .insert(organizations)
      .values({ name: `Cross ${suffix}`, slug: `cross-${suffix}` })
      .returning();
    const [workspaceA] = await database.db
      .insert(workspaces)
      .values({
        organizationId: org!.id,
        name: 'Workspace A',
        slug: `ws-a-${suffix}`,
      })
      .returning();
    const [workspaceB] = await database.db
      .insert(workspaces)
      .values({
        organizationId: org!.id,
        name: 'Workspace B',
        slug: `ws-b-${suffix}`,
      })
      .returning();
    const [projectA] = await database.db
      .insert(projects)
      .values({
        workspaceId: workspaceA!.id,
        name: 'RelayHorizon',
        slug: `outpost-${suffix}`,
        status: 'active',
      })
      .returning();
    await database.db.insert(projects).values({
      workspaceId: workspaceB!.id,
      name: 'Other outpost',
      slug: `outpost-${suffix}`,
      status: 'active',
    });
    await retireProjectSlug(database.db, {
      projectId: projectA!.id,
      workspaceId: workspaceA!.id,
      previousSlug: `outpost-${suffix}`,
      nextSlug: `relayhorizon-${suffix}`,
      actorUserId: null,
    });
    await database.db
      .update(projects)
      .set({ slug: `relayhorizon-${suffix}` })
      .where(eq(projects.id, projectA!.id));

    const scoped = await resolveProjectSlug(database, {
      workspaceId: workspaceA!.id,
      slug: `outpost-${suffix}`,
    });
    expect(scoped.project.id).toBe(projectA!.id);
    expect(scoped.redirect).toBe(true);

    const matches = await listSlugMatches(database, `outpost-${suffix}`);
    expect(matches).toHaveLength(2);
    expect(matches.map((row) => row.retired).sort()).toEqual([false, true]);
  });
});
