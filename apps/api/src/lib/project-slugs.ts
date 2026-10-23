import { and, desc, eq, isNull, ne, sql } from 'drizzle-orm';
import { slugify } from '@project-knowledge-hub/auth';
import type { Database } from '@project-knowledge-hub/database';
import { projectSlugHistory, projects } from '@project-knowledge-hub/database';
import { AppError } from '@project-knowledge-hub/domain';

type SlugDb = Pick<Database['db'], 'select' | 'insert' | 'update'>;

/** Route segment used by the create-project page. */
const RESERVED_PROJECT_SLUGS = new Set(['new']);

const SLUG_MAX = 64;

export type WorkspaceSlugStatus = 'free' | 'current' | 'retired' | 'reserved';

export function normalizeProjectSlug(input: string): string {
  const slug = slugify(input).slice(0, SLUG_MAX);
  if (!slug) {
    throw new AppError({
      code: 'VALIDATION_ERROR',
      message: 'Project slug is invalid',
      statusCode: 400,
    });
  }
  if (RESERVED_PROJECT_SLUGS.has(slug)) {
    throw new AppError({
      code: 'PROJECT_SLUG_RESERVED',
      message: `Project slug "${slug}" is reserved`,
      statusCode: 400,
    });
  }
  return slug;
}

/**
 * A project matches a slug when it is the current slug or an unreleased
 * historical slug. The same slug in another workspace is a second candidate,
 * the same way an unscoped prefix is ambiguous (PRO-T-3).
 */
export function sqlProjectMatchesSlug(slug: string) {
  return sql`(
    ${projects.slug} = ${slug}
    or exists (
      select 1
      from project_slug_history as slug_history
      where slug_history.project_id = ${projects.id}
        and slug_history.released_at is null
        and slug_history.slug = ${slug}
    )
  )`;
}

export async function workspaceProjectSlugStatus(
  db: SlugDb,
  input: {
    workspaceId: string;
    slug: string;
    excludeProjectId?: string;
  },
): Promise<WorkspaceSlugStatus> {
  const slug = slugify(input.slug).slice(0, SLUG_MAX);
  if (!slug) return 'free';
  if (RESERVED_PROJECT_SLUGS.has(slug)) return 'reserved';

  const currentConditions = [
    eq(projects.workspaceId, input.workspaceId),
    eq(projects.slug, slug),
  ];
  if (input.excludeProjectId) {
    currentConditions.push(ne(projects.id, input.excludeProjectId));
  }
  const [current] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(...currentConditions))
    .limit(1);
  if (current) return 'current';

  const historyConditions = [
    eq(projectSlugHistory.workspaceId, input.workspaceId),
    eq(projectSlugHistory.slug, slug),
    isNull(projectSlugHistory.releasedAt),
  ];
  if (input.excludeProjectId) {
    historyConditions.push(ne(projectSlugHistory.projectId, input.excludeProjectId));
  }
  const [retired] = await db
    .select({ id: projectSlugHistory.id })
    .from(projectSlugHistory)
    .where(and(...historyConditions))
    .limit(1);
  return retired ? 'retired' : 'free';
}

export async function assertUniqueProjectSlug(
  database: Database,
  input: {
    workspaceId: string;
    slug: string;
    excludeProjectId?: string;
  },
): Promise<string> {
  const slug = normalizeProjectSlug(input.slug);
  const status = await workspaceProjectSlugStatus(database.db, {
    workspaceId: input.workspaceId,
    slug,
    excludeProjectId: input.excludeProjectId,
  });
  if (status === 'current') {
    throw new AppError({
      code: 'PROJECT_SLUG_CONFLICT',
      message: 'A project with this slug already exists in the workspace',
      statusCode: 409,
    });
  }
  if (status === 'retired') {
    throw new AppError({
      code: 'PROJECT_SLUG_CONFLICT',
      message:
        'This slug is reserved by another project in the workspace until a workspace admin releases it',
      statusCode: 409,
    });
  }
  return slug;
}

/**
 * Record the previous slug when it actually changes. Reclaiming a slug this
 * project already retired releases that history row so the current value and
 * the reservation are not stored twice.
 */
export async function retireProjectSlug(
  db: SlugDb,
  input: {
    projectId: string;
    workspaceId: string;
    previousSlug: string;
    nextSlug: string;
    actorUserId: string | null;
  },
): Promise<boolean> {
  const previous = input.previousSlug;
  const next = input.nextSlug;
  if (!previous || previous === next) return false;

  await db
    .update(projectSlugHistory)
    .set({
      releasedAt: new Date(),
      releasedBy: input.actorUserId,
    })
    .where(
      and(
        eq(projectSlugHistory.projectId, input.projectId),
        eq(projectSlugHistory.slug, next),
        isNull(projectSlugHistory.releasedAt),
      ),
    );

  const [existing] = await db
    .select({ id: projectSlugHistory.id })
    .from(projectSlugHistory)
    .where(
      and(
        eq(projectSlugHistory.projectId, input.projectId),
        eq(projectSlugHistory.slug, previous),
        isNull(projectSlugHistory.releasedAt),
      ),
    )
    .limit(1);
  if (!existing) {
    await db.insert(projectSlugHistory).values({
      projectId: input.projectId,
      workspaceId: input.workspaceId,
      slug: previous,
      retiredBy: input.actorUserId,
    });
  }
  return true;
}

export async function listProjectSlugHistory(database: Database, projectId: string) {
  return database.db
    .select({
      slug: projectSlugHistory.slug,
      retiredAt: projectSlugHistory.retiredAt,
      releasedAt: projectSlugHistory.releasedAt,
    })
    .from(projectSlugHistory)
    .where(eq(projectSlugHistory.projectId, projectId))
    .orderBy(desc(projectSlugHistory.retiredAt));
}

export async function releaseProjectSlug(
  database: Database,
  input: {
    projectId: string;
    slug: string;
    actorUserId: string;
  },
): Promise<{ slug: string }> {
  const slug = slugify(input.slug).slice(0, SLUG_MAX);
  const [row] = await database.db
    .update(projectSlugHistory)
    .set({
      releasedAt: new Date(),
      releasedBy: input.actorUserId,
    })
    .where(
      and(
        eq(projectSlugHistory.projectId, input.projectId),
        eq(projectSlugHistory.slug, slug),
        isNull(projectSlugHistory.releasedAt),
      ),
    )
    .returning({ slug: projectSlugHistory.slug });
  if (!row) {
    throw new AppError({
      code: 'PROJECT_SLUG_NOT_RESERVED',
      message: `Slug ${slug || input.slug} is not a retired slug of this project`,
      statusCode: 404,
    });
  }
  return { slug: row.slug };
}

export async function resolveProjectSlug(
  database: Database,
  input: { workspaceId: string; slug: string },
): Promise<{
  project: { id: string; slug: string; name: string };
  redirect: boolean;
}> {
  const slug = slugify(input.slug).slice(0, SLUG_MAX);
  if (!slug || RESERVED_PROJECT_SLUGS.has(slug)) {
    throw new AppError({
      code: 'PROJECT_NOT_FOUND',
      message: 'Project not found',
      statusCode: 404,
    });
  }
  const [current] = await database.db
    .select({ id: projects.id, slug: projects.slug, name: projects.name })
    .from(projects)
    .where(and(eq(projects.workspaceId, input.workspaceId), eq(projects.slug, slug)))
    .limit(1);
  if (current) return { project: current, redirect: false };

  const [historical] = await database.db
    .select({ id: projects.id, slug: projects.slug, name: projects.name })
    .from(projectSlugHistory)
    .innerJoin(projects, eq(projects.id, projectSlugHistory.projectId))
    .where(
      and(
        eq(projectSlugHistory.workspaceId, input.workspaceId),
        eq(projectSlugHistory.slug, slug),
        isNull(projectSlugHistory.releasedAt),
      ),
    )
    .limit(1);
  if (!historical) {
    throw new AppError({
      code: 'PROJECT_NOT_FOUND',
      message: 'Project not found',
      statusCode: 404,
    });
  }
  return { project: historical, redirect: true };
}

/**
 * Current and unreleased historical uses of a slug in any workspace.
 * More than one row means an unscoped lookup is ambiguous.
 */
export async function listSlugMatches(
  database: Database,
  slugInput: string,
): Promise<
  Array<{
    projectId: string;
    workspaceId: string;
    name: string;
    currentSlug: string;
    retired: boolean;
  }>
> {
  const slug = slugify(slugInput).slice(0, SLUG_MAX);
  if (!slug) return [];
  const current = await database.db
    .select({
      projectId: projects.id,
      workspaceId: projects.workspaceId,
      name: projects.name,
      currentSlug: projects.slug,
    })
    .from(projects)
    .where(eq(projects.slug, slug));
  const retired = await database.db
    .select({
      projectId: projects.id,
      workspaceId: projects.workspaceId,
      name: projects.name,
      currentSlug: projects.slug,
    })
    .from(projectSlugHistory)
    .innerJoin(projects, eq(projects.id, projectSlugHistory.projectId))
    .where(
      and(eq(projectSlugHistory.slug, slug), isNull(projectSlugHistory.releasedAt)),
    );
  const seen = new Set(current.map((row) => row.projectId));
  return [
    ...current.map((row) => ({ ...row, retired: false })),
    ...retired
      .filter((row) => !seen.has(row.projectId))
      .map((row) => ({ ...row, retired: true })),
  ];
}
