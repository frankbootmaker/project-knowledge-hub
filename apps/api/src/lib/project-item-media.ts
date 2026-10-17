import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import {
  projectChangeItems,
  projectEpics,
  projectItemMediaLinks,
  projectMilestones,
  projectRaidItems,
  projectSprints,
  projectTasks,
  projectUserStories,
  projects,
  users,
  workspaceMedia,
  type Database,
} from '@project-knowledge-hub/database';
import {
  AppError,
  assertPublicHttpUrl,
  formatHumanKey,
  itemMediaEntityTypeSchema,
  type ItemMediaEntityType,
} from '@project-knowledge-hub/domain';
import { WORKSPACE_MEDIA_READ_HINT } from './media-read-access.js';

const MAX_LINKS = 100;
const MAX_TITLE = 200;
const MAX_DESCRIPTION = 2000;
const USED_BY_CAP = 8;

export type PublicItemMediaLink = {
  id: string;
  kind: 'media' | 'url';
  title: string | null;
  description: string | null;
  url: string | null;
  filename: string | null;
  byteSize: number | null;
  contentType: string | null;
  mediaId: string | null;
  deleted: boolean;
  /** Present on a live workspace image. Tells MCP clients which tool reads pixels. */
  hint: string | null;
  addedBy: { userId: string; displayName: string } | null;
  addedAt: string;
  sortOrder: number;
};

export type MediaUsedBy = {
  entityType: ItemMediaEntityType;
  entityId: string;
  humanKey: string | null;
  title: string;
};

export type ItemMediaLinkInput =
  | {
      kind: 'media';
      mediaId: string;
      title?: string | null;
      description?: string | null;
    }
  | {
      kind: 'url';
      url: string;
      title: string;
      description?: string | null;
    };

type NormalizedLink =
  | {
      kind: 'media';
      mediaId: string;
      title: string | null;
      description: string | null;
    }
  | {
      kind: 'url';
      url: string;
      title: string;
      description: string | null;
    };

type EntityRow = {
  projectId: string;
  title: string;
  issueKeyType: string | null;
  issueNumber: number | null;
};

function optionalText(
  value: string | null | undefined,
  max: number,
  field: string,
): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > max) {
    throw new AppError({
      code: 'VALIDATION_ERROR',
      message: `${field} must be at most ${max} characters`,
      statusCode: 400,
    });
  }
  return trimmed;
}

function normalizeLinks(links: ItemMediaLinkInput[]): NormalizedLink[] {
  if (links.length > MAX_LINKS) {
    throw new AppError({
      code: 'VALIDATION_ERROR',
      message: `At most ${MAX_LINKS} media links are allowed`,
      statusCode: 400,
    });
  }
  const seen = new Set<string>();
  const ordered: NormalizedLink[] = [];
  for (const link of links) {
    if (link.kind === 'media') {
      const key = `media:${link.mediaId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      ordered.push({
        kind: 'media',
        mediaId: link.mediaId,
        title: optionalText(link.title, MAX_TITLE, 'title'),
        description: optionalText(link.description, MAX_DESCRIPTION, 'description'),
      });
      continue;
    }
    const url = assertPublicHttpUrl(link.url);
    const title = optionalText(link.title, MAX_TITLE, 'title');
    if (!title) {
      throw new AppError({
        code: 'VALIDATION_ERROR',
        message: 'An external URL needs a title',
        statusCode: 400,
      });
    }
    const key = `url:${url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    ordered.push({
      kind: 'url',
      url,
      title,
      description: optionalText(link.description, MAX_DESCRIPTION, 'description'),
    });
  }
  return ordered;
}

async function loadEntity(
  database: Database,
  entityType: ItemMediaEntityType,
  entityId: string,
): Promise<EntityRow | null> {
  if (entityType === 'epic') {
    const [row] = await database.db
      .select({
        projectId: projectEpics.projectId,
        title: projectEpics.title,
        issueKeyType: projectEpics.issueKeyType,
        issueNumber: projectEpics.issueNumber,
      })
      .from(projectEpics)
      .where(eq(projectEpics.id, entityId))
      .limit(1);
    return row ?? null;
  }
  if (entityType === 'user_story') {
    const [row] = await database.db
      .select({
        projectId: projectUserStories.projectId,
        title: projectUserStories.title,
        issueKeyType: projectUserStories.issueKeyType,
        issueNumber: projectUserStories.issueNumber,
      })
      .from(projectUserStories)
      .where(eq(projectUserStories.id, entityId))
      .limit(1);
    return row ?? null;
  }
  if (entityType === 'milestone') {
    const [row] = await database.db
      .select({
        projectId: projectMilestones.projectId,
        title: projectMilestones.title,
        issueKeyType: projectMilestones.issueKeyType,
        issueNumber: projectMilestones.issueNumber,
      })
      .from(projectMilestones)
      .where(eq(projectMilestones.id, entityId))
      .limit(1);
    return row ?? null;
  }
  if (entityType === 'sprint') {
    const [row] = await database.db
      .select({
        projectId: projectSprints.projectId,
        title: projectSprints.name,
        issueKeyType: projectSprints.issueKeyType,
        issueNumber: projectSprints.issueNumber,
      })
      .from(projectSprints)
      .where(eq(projectSprints.id, entityId))
      .limit(1);
    return row ?? null;
  }
  if (entityType === 'raid') {
    const [row] = await database.db
      .select({
        projectId: projectRaidItems.projectId,
        title: projectRaidItems.title,
        issueKeyType: projectRaidItems.issueKeyType,
        issueNumber: projectRaidItems.issueNumber,
      })
      .from(projectRaidItems)
      .where(eq(projectRaidItems.id, entityId))
      .limit(1);
    return row ?? null;
  }
  if (entityType === 'change') {
    const [row] = await database.db
      .select({
        projectId: projectChangeItems.projectId,
        title: projectChangeItems.title,
        issueKeyType: projectChangeItems.issueKeyType,
        issueNumber: projectChangeItems.issueNumber,
      })
      .from(projectChangeItems)
      .where(eq(projectChangeItems.id, entityId))
      .limit(1);
    return row ?? null;
  }
  const [row] = await database.db
    .select({
      projectId: projectTasks.projectId,
      title: projectTasks.title,
      issueKeyType: projectTasks.issueKeyType,
      issueNumber: projectTasks.issueNumber,
    })
    .from(projectTasks)
    .where(eq(projectTasks.id, entityId))
    .limit(1);
  return row ?? null;
}

async function assertEntityInProject(
  database: Database,
  projectId: string,
  entityType: ItemMediaEntityType,
  entityId: string,
): Promise<EntityRow> {
  const entity = await loadEntity(database, entityType, entityId);
  if (!entity) {
    throw new AppError({
      code: 'ITEM_MEDIA_ENTITY_NOT_FOUND',
      message: `Item not found: ${entityType}`,
      statusCode: 400,
    });
  }
  if (entity.projectId !== projectId) {
    throw new AppError({
      code: 'ITEM_MEDIA_PROJECT_MISMATCH',
      message: 'Media links must target an item in this project',
      statusCode: 400,
    });
  }
  return entity;
}

async function projectWorkspaceId(
  database: Database,
  projectId: string,
): Promise<string> {
  const [project] = await database.db
    .select({ workspaceId: projects.workspaceId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project) {
    throw new AppError({
      code: 'PROJECT_NOT_FOUND',
      message: 'Project not found',
      statusCode: 404,
    });
  }
  return project.workspaceId;
}

function toPublicLink(row: {
  id: string;
  kind: string;
  title: string | null;
  description: string | null;
  url: string | null;
  sortOrder: number;
  createdBy: string | null;
  createdAt: Date;
  displayName: string | null;
  mediaId: string | null;
  filename: string | null;
  byteSize: number | null;
  contentType: string | null;
  archivedAt: Date | null;
}): PublicItemMediaLink {
  const kind = row.kind === 'url' ? 'url' : 'media';
  const deleted = kind === 'media' && (row.mediaId == null || row.archivedAt != null);
  return {
    id: row.id,
    kind,
    title: row.title ?? row.filename,
    description: row.description,
    url:
      kind === 'url'
        ? row.url
        : deleted || !row.mediaId
          ? null
          : `/api/v1/media/${row.mediaId}`,
    filename: row.filename,
    byteSize: deleted ? null : row.byteSize,
    contentType: deleted ? null : row.contentType,
    mediaId: row.mediaId,
    deleted,
    hint: kind === 'media' && row.mediaId && !deleted ? WORKSPACE_MEDIA_READ_HINT : null,
    addedBy: row.createdBy
      ? { userId: row.createdBy, displayName: row.displayName ?? '' }
      : null,
    addedAt: row.createdAt.toISOString(),
    sortOrder: row.sortOrder,
  };
}

export async function listItemMediaLinks(
  database: Database,
  input: { entityType: ItemMediaEntityType; entityId: string },
): Promise<PublicItemMediaLink[]> {
  const rows = await database.db
    .select({
      id: projectItemMediaLinks.id,
      kind: projectItemMediaLinks.kind,
      title: projectItemMediaLinks.title,
      description: projectItemMediaLinks.description,
      url: projectItemMediaLinks.url,
      sortOrder: projectItemMediaLinks.sortOrder,
      createdBy: projectItemMediaLinks.createdBy,
      createdAt: projectItemMediaLinks.createdAt,
      displayName: users.displayName,
      mediaId: workspaceMedia.id,
      filename: workspaceMedia.originalFilename,
      byteSize: workspaceMedia.byteSize,
      contentType: workspaceMedia.contentType,
      archivedAt: workspaceMedia.archivedAt,
    })
    .from(projectItemMediaLinks)
    .leftJoin(workspaceMedia, eq(workspaceMedia.id, projectItemMediaLinks.workspaceMediaId))
    .leftJoin(users, eq(users.id, projectItemMediaLinks.createdBy))
    .where(
      and(
        eq(projectItemMediaLinks.entityType, input.entityType),
        eq(projectItemMediaLinks.entityId, input.entityId),
      ),
    )
    .orderBy(asc(projectItemMediaLinks.sortOrder), asc(projectItemMediaLinks.createdAt));
  return rows.map(toPublicLink);
}

export async function withMediaLinkCounts<T extends { id: string }>(
  database: Database,
  entityType: ItemMediaEntityType,
  items: T[],
): Promise<Array<T & { mediaLinkCount: number }>> {
  if (items.length === 0) return [];
  const ids = items.map((item) => item.id);
  const counts = await database.db
    .select({
      entityId: projectItemMediaLinks.entityId,
      total: sql<number>`count(*)::int`,
    })
    .from(projectItemMediaLinks)
    .where(
      and(
        eq(projectItemMediaLinks.entityType, entityType),
        inArray(projectItemMediaLinks.entityId, ids),
      ),
    )
    .groupBy(projectItemMediaLinks.entityId);
  const byId = new Map(counts.map((row) => [row.entityId, Number(row.total)]));
  return items.map((item) => ({
    ...item,
    mediaLinkCount: byId.get(item.id) ?? 0,
  }));
}

export async function withMediaLinks<T extends { id: string }>(
  database: Database,
  entityType: ItemMediaEntityType,
  item: T,
): Promise<T & { mediaLinkCount: number; mediaLinks: PublicItemMediaLink[] }> {
  const [withLinks] = await attachItemMediaLinks(database, entityType, [item]);
  return withLinks ?? { ...item, mediaLinks: [], mediaLinkCount: 0 };
}

/** Full Media-tab links for a page of items. Count matches the link array. */
export async function attachItemMediaLinks<T extends { id: string }>(
  database: Database,
  entityType: ItemMediaEntityType,
  items: T[],
): Promise<Array<T & { mediaLinkCount: number; mediaLinks: PublicItemMediaLink[] }>> {
  if (items.length === 0) return [];
  const ids = items.map((item) => item.id);
  const rows = await database.db
    .select({
      entityId: projectItemMediaLinks.entityId,
      id: projectItemMediaLinks.id,
      kind: projectItemMediaLinks.kind,
      title: projectItemMediaLinks.title,
      description: projectItemMediaLinks.description,
      url: projectItemMediaLinks.url,
      sortOrder: projectItemMediaLinks.sortOrder,
      createdBy: projectItemMediaLinks.createdBy,
      createdAt: projectItemMediaLinks.createdAt,
      displayName: users.displayName,
      mediaId: workspaceMedia.id,
      filename: workspaceMedia.originalFilename,
      byteSize: workspaceMedia.byteSize,
      contentType: workspaceMedia.contentType,
      archivedAt: workspaceMedia.archivedAt,
    })
    .from(projectItemMediaLinks)
    .leftJoin(workspaceMedia, eq(workspaceMedia.id, projectItemMediaLinks.workspaceMediaId))
    .leftJoin(users, eq(users.id, projectItemMediaLinks.createdBy))
    .where(
      and(
        eq(projectItemMediaLinks.entityType, entityType),
        inArray(projectItemMediaLinks.entityId, ids),
      ),
    )
    .orderBy(asc(projectItemMediaLinks.sortOrder), asc(projectItemMediaLinks.createdAt));
  const grouped = new Map<string, PublicItemMediaLink[]>();
  for (const row of rows) {
    const list = grouped.get(row.entityId) ?? [];
    list.push(toPublicLink(row));
    grouped.set(row.entityId, list);
  }
  return items.map((item) => {
    const mediaLinks = grouped.get(item.id) ?? [];
    return { ...item, mediaLinks, mediaLinkCount: mediaLinks.length };
  });
}

/**
 * The item must exist and its project must live in `workspaceId`.
 * Used by MCP upload and media list filters so a link cannot cross workspaces.
 */
export async function requireItemMediaTarget(
  database: Database,
  input: {
    workspaceId: string;
    entityType: ItemMediaEntityType;
    entityId: string;
  },
): Promise<{ projectId: string }> {
  const entity = await loadEntity(database, input.entityType, input.entityId);
  if (!entity) {
    throw new AppError({
      code: 'ITEM_MEDIA_ENTITY_NOT_FOUND',
      message: `Item not found: ${input.entityType}`,
      statusCode: 404,
    });
  }
  const workspaceId = await projectWorkspaceId(database, entity.projectId);
  if (workspaceId !== input.workspaceId) {
    throw new AppError({
      code: 'ITEM_MEDIA_WORKSPACE_MISMATCH',
      message: 'The item is outside the workspace',
      statusCode: 400,
    });
  }
  return { projectId: entity.projectId };
}

export async function setItemMediaLinks(
  database: Database,
  input: {
    projectId: string;
    entityType: ItemMediaEntityType;
    entityId: string;
    links: ItemMediaLinkInput[];
    createdBy?: string | null;
  },
): Promise<PublicItemMediaLink[]> {
  await assertEntityInProject(
    database,
    input.projectId,
    input.entityType,
    input.entityId,
  );
  const workspaceId = await projectWorkspaceId(database, input.projectId);
  const desired = normalizeLinks(input.links);
  const mediaIds = desired.flatMap((link) =>
    link.kind === 'media' ? [link.mediaId] : [],
  );
  if (mediaIds.length > 0) {
    const currentLinks = await database.db
      .select({ mediaId: projectItemMediaLinks.workspaceMediaId })
      .from(projectItemMediaLinks)
      .where(
        and(
          eq(projectItemMediaLinks.entityType, input.entityType),
          eq(projectItemMediaLinks.entityId, input.entityId),
          eq(projectItemMediaLinks.kind, 'media'),
        ),
      );
    const alreadyLinked = new Set(
      currentLinks.flatMap((row) => (row.mediaId ? [row.mediaId] : [])),
    );
    const rows = await database.db
      .select({
        id: workspaceMedia.id,
        workspaceId: workspaceMedia.workspaceId,
        archivedAt: workspaceMedia.archivedAt,
      })
      .from(workspaceMedia)
      .where(inArray(workspaceMedia.id, mediaIds));
    const found = new Map(rows.map((row) => [row.id, row]));
    for (const mediaId of mediaIds) {
      const media = found.get(mediaId);
      if (!media || (media.archivedAt && !alreadyLinked.has(mediaId))) {
        throw new AppError({
          code: 'MEDIA_NOT_FOUND',
          message: 'Linked media was not found',
          statusCode: 400,
        });
      }
      if (media.workspaceId !== workspaceId) {
        throw new AppError({
          code: 'ITEM_MEDIA_WORKSPACE_MISMATCH',
          message: 'Media must belong to the project workspace',
          statusCode: 400,
        });
      }
    }
  }

  await database.db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(projectItemMediaLinks)
      .where(
        and(
          eq(projectItemMediaLinks.entityType, input.entityType),
          eq(projectItemMediaLinks.entityId, input.entityId),
        ),
      );
    const byKey = new Map(
      existing.map((row) => [
        row.kind === 'url' ? `url:${row.url}` : `media:${row.workspaceMediaId}`,
        row,
      ]),
    );
    const keep = new Set<string>();
    for (const [index, link] of desired.entries()) {
      const key = link.kind === 'url' ? `url:${link.url}` : `media:${link.mediaId}`;
      keep.add(key);
      const current = byKey.get(key);
      if (current) {
        await tx
          .update(projectItemMediaLinks)
          .set({
            sortOrder: index,
            title: link.title,
            description: link.description,
          })
          .where(eq(projectItemMediaLinks.id, current.id));
        continue;
      }
      await tx.insert(projectItemMediaLinks).values({
        projectId: input.projectId,
        entityType: input.entityType,
        entityId: input.entityId,
        kind: link.kind,
        workspaceMediaId: link.kind === 'media' ? link.mediaId : null,
        url: link.kind === 'url' ? link.url : null,
        title: link.title,
        description: link.description,
        sortOrder: index,
        createdBy: input.createdBy ?? null,
      });
    }
    const remove = existing.filter((row) => {
      const key = row.kind === 'url' ? `url:${row.url}` : `media:${row.workspaceMediaId}`;
      return !keep.has(key);
    });
    if (remove.length > 0) {
      await tx
        .delete(projectItemMediaLinks)
        .where(
          inArray(
            projectItemMediaLinks.id,
            remove.map((row) => row.id),
          ),
        );
    }
  });

  return listItemMediaLinks(database, {
    entityType: input.entityType,
    entityId: input.entityId,
  });
}

/** Append one library image to an item. Used when an upload names a target. */
export async function appendMediaLink(
  database: Database,
  input: {
    workspaceId: string;
    mediaId: string;
    entityType: ItemMediaEntityType;
    entityId: string;
    createdBy?: string | null;
  },
): Promise<void> {
  const entity = await loadEntity(database, input.entityType, input.entityId);
  if (!entity) {
    throw new AppError({
      code: 'ITEM_MEDIA_ENTITY_NOT_FOUND',
      message: `Item not found: ${input.entityType}`,
      statusCode: 400,
    });
  }
  const workspaceId = await projectWorkspaceId(database, entity.projectId);
  if (workspaceId !== input.workspaceId) {
    throw new AppError({
      code: 'ITEM_MEDIA_WORKSPACE_MISMATCH',
      message: 'The item is outside the workspace',
      statusCode: 400,
    });
  }
  const [media] = await database.db
    .select({
      id: workspaceMedia.id,
      workspaceId: workspaceMedia.workspaceId,
      archivedAt: workspaceMedia.archivedAt,
    })
    .from(workspaceMedia)
    .where(eq(workspaceMedia.id, input.mediaId))
    .limit(1);
  if (!media || media.archivedAt || media.workspaceId !== input.workspaceId) {
    throw new AppError({
      code: 'MEDIA_NOT_FOUND',
      message: 'Linked media was not found',
      statusCode: 400,
    });
  }
  const [existing] = await database.db
    .select({ id: projectItemMediaLinks.id })
    .from(projectItemMediaLinks)
    .where(
      and(
        eq(projectItemMediaLinks.entityType, input.entityType),
        eq(projectItemMediaLinks.entityId, input.entityId),
        eq(projectItemMediaLinks.workspaceMediaId, input.mediaId),
      ),
    )
    .limit(1);
  if (existing) return;
  const [last] = await database.db
    .select({ sortOrder: projectItemMediaLinks.sortOrder })
    .from(projectItemMediaLinks)
    .where(
      and(
        eq(projectItemMediaLinks.entityType, input.entityType),
        eq(projectItemMediaLinks.entityId, input.entityId),
      ),
    )
    .orderBy(sql`${projectItemMediaLinks.sortOrder} desc`)
    .limit(1);
  await database.db.insert(projectItemMediaLinks).values({
    projectId: entity.projectId,
    entityType: input.entityType,
    entityId: input.entityId,
    kind: 'media',
    workspaceMediaId: input.mediaId,
    sortOrder: (last?.sortOrder ?? -1) + 1,
    createdBy: input.createdBy ?? null,
  });
}

export async function mediaUsedBy(
  database: Database,
  mediaIds: string[],
): Promise<Map<string, MediaUsedBy[]>> {
  const result = new Map<string, MediaUsedBy[]>();
  if (mediaIds.length === 0) return result;
  const links = await database.db
    .select({
      mediaId: projectItemMediaLinks.workspaceMediaId,
      entityType: projectItemMediaLinks.entityType,
      entityId: projectItemMediaLinks.entityId,
    })
    .from(projectItemMediaLinks)
    .where(
      and(
        eq(projectItemMediaLinks.kind, 'media'),
        inArray(projectItemMediaLinks.workspaceMediaId, mediaIds),
      ),
    );
  const idsByType = new Map<ItemMediaEntityType, string[]>();
  for (const link of links) {
    const parsed = itemMediaEntityTypeSchema.safeParse(link.entityType);
    if (!parsed.success || !link.mediaId) continue;
    const list = idsByType.get(parsed.data) ?? [];
    list.push(link.entityId);
    idsByType.set(parsed.data, list);
  }
  const entities = new Map<string, EntityRow>();
  for (const [entityType, ids] of idsByType) {
    const unique = [...new Set(ids)];
    for (const entityId of unique) {
      const entity = await loadEntity(database, entityType, entityId);
      if (entity) entities.set(`${entityType}:${entityId}`, entity);
    }
  }
  const projectIds = [...new Set([...entities.values()].map((row) => row.projectId))];
  const prefixes = new Map<string, string | null>();
  if (projectIds.length > 0) {
    const rows = await database.db
      .select({ id: projects.id, keyPrefix: projects.keyPrefix })
      .from(projects)
      .where(inArray(projects.id, projectIds));
    for (const row of rows) prefixes.set(row.id, row.keyPrefix);
  }
  for (const link of links) {
    if (!link.mediaId) continue;
    const parsed = itemMediaEntityTypeSchema.safeParse(link.entityType);
    if (!parsed.success) continue;
    const bucket = result.get(link.mediaId) ?? [];
    if (bucket.length >= USED_BY_CAP) continue;
    const entity = entities.get(`${parsed.data}:${link.entityId}`);
    if (!entity) continue;
    bucket.push({
      entityType: parsed.data,
      entityId: link.entityId,
      humanKey: formatHumanKey(
        prefixes.get(entity.projectId),
        entity.issueKeyType,
        entity.issueNumber,
      ),
      title: entity.title,
    });
    result.set(link.mediaId, bucket);
  }
  return result;
}
