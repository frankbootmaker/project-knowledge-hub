import { and, eq, inArray, ne } from 'drizzle-orm';
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
  workspaceMedia,
  workspaces,
  type Database,
} from '@project-knowledge-hub/database';
import { AppError, formatHumanKey } from '@project-knowledge-hub/domain';

export type WorkspacePurgeBlocker = {
  kind: 'item_media';
  count: number;
  itemKey: string | null;
  itemTitle: string;
  entityType: string;
  entityId: string;
  workspaceId: string;
  workspaceName: string;
};

type EntityKey = {
  title: string;
  issueKeyType: string | null;
  issueNumber: number | null;
};

export function formatWorkspacePurgeMessage(blockers: WorkspacePurgeBlocker[]): string {
  return blockers
    .map((blocker) => {
      const item = blocker.itemKey ?? blocker.itemTitle;
      const files = blocker.count === 1 ? '1 media file' : `${blocker.count} media files`;
      return `${files} used by ${item} in workspace ${blocker.workspaceName}`;
    })
    .join('; ');
}

async function entityKeys(
  database: Database,
  entityType: string,
  ids: string[],
): Promise<Map<string, EntityKey>> {
  const unique = [...new Set(ids)];
  const empty = new Map<string, EntityKey>();
  if (unique.length === 0) return empty;

  const rows = await (async () => {
    switch (entityType) {
      case 'task':
        return database.db
          .select({
            id: projectTasks.id,
            title: projectTasks.title,
            issueKeyType: projectTasks.issueKeyType,
            issueNumber: projectTasks.issueNumber,
          })
          .from(projectTasks)
          .where(inArray(projectTasks.id, unique));
      case 'epic':
        return database.db
          .select({
            id: projectEpics.id,
            title: projectEpics.title,
            issueKeyType: projectEpics.issueKeyType,
            issueNumber: projectEpics.issueNumber,
          })
          .from(projectEpics)
          .where(inArray(projectEpics.id, unique));
      case 'user_story':
        return database.db
          .select({
            id: projectUserStories.id,
            title: projectUserStories.title,
            issueKeyType: projectUserStories.issueKeyType,
            issueNumber: projectUserStories.issueNumber,
          })
          .from(projectUserStories)
          .where(inArray(projectUserStories.id, unique));
      case 'milestone':
        return database.db
          .select({
            id: projectMilestones.id,
            title: projectMilestones.title,
            issueKeyType: projectMilestones.issueKeyType,
            issueNumber: projectMilestones.issueNumber,
          })
          .from(projectMilestones)
          .where(inArray(projectMilestones.id, unique));
      case 'sprint':
        return database.db
          .select({
            id: projectSprints.id,
            title: projectSprints.name,
            issueKeyType: projectSprints.issueKeyType,
            issueNumber: projectSprints.issueNumber,
          })
          .from(projectSprints)
          .where(inArray(projectSprints.id, unique));
      case 'raid':
        return database.db
          .select({
            id: projectRaidItems.id,
            title: projectRaidItems.title,
            issueKeyType: projectRaidItems.issueKeyType,
            issueNumber: projectRaidItems.issueNumber,
          })
          .from(projectRaidItems)
          .where(inArray(projectRaidItems.id, unique));
      case 'change':
        return database.db
          .select({
            id: projectChangeItems.id,
            title: projectChangeItems.title,
            issueKeyType: projectChangeItems.issueKeyType,
            issueNumber: projectChangeItems.issueNumber,
          })
          .from(projectChangeItems)
          .where(inArray(projectChangeItems.id, unique));
      default:
        return [];
    }
  })();

  return new Map(
    rows.map((row) => [
      row.id,
      {
        title: row.title,
        issueKeyType: row.issueKeyType,
        issueNumber: row.issueNumber,
      },
    ]),
  );
}

export async function findWorkspacePurgeBlockers(
  database: Database,
  workspaceId: string,
): Promise<WorkspacePurgeBlocker[]> {
  const links = await database.db
    .select({
      entityType: projectItemMediaLinks.entityType,
      entityId: projectItemMediaLinks.entityId,
      keyPrefix: projects.keyPrefix,
      workspaceId: workspaces.id,
      workspaceName: workspaces.name,
    })
    .from(projectItemMediaLinks)
    .innerJoin(workspaceMedia, eq(workspaceMedia.id, projectItemMediaLinks.workspaceMediaId))
    .innerJoin(projects, eq(projects.id, projectItemMediaLinks.projectId))
    .innerJoin(workspaces, eq(workspaces.id, projects.workspaceId))
    .where(
      and(
        eq(workspaceMedia.workspaceId, workspaceId),
        ne(projects.workspaceId, workspaceId),
        eq(projectItemMediaLinks.kind, 'media'),
      ),
    );

  const idsByType = new Map<string, string[]>();
  const grouped = new Map<
    string,
    {
      entityType: string;
      entityId: string;
      keyPrefix: string | null;
      workspaceId: string;
      workspaceName: string;
      count: number;
    }
  >();
  for (const link of links) {
    const key = `${link.entityType}:${link.entityId}`;
    const current = grouped.get(key);
    if (current) {
      current.count += 1;
    } else {
      grouped.set(key, { ...link, count: 1 });
      const ids = idsByType.get(link.entityType) ?? [];
      ids.push(link.entityId);
      idsByType.set(link.entityType, ids);
    }
  }

  const entities = new Map<string, EntityKey>();
  for (const [entityType, ids] of idsByType) {
    const loaded = await entityKeys(database, entityType, ids);
    for (const [id, entity] of loaded) {
      entities.set(`${entityType}:${id}`, entity);
    }
  }

  const blockers: WorkspacePurgeBlocker[] = [...grouped.values()].map((group) => {
    const entity = entities.get(`${group.entityType}:${group.entityId}`);
    const itemKey = entity
      ? formatHumanKey(group.keyPrefix, entity.issueKeyType, entity.issueNumber)
      : null;
    return {
      kind: 'item_media',
      count: group.count,
      itemKey,
      itemTitle: entity?.title ?? group.entityType,
      entityType: group.entityType,
      entityId: group.entityId,
      workspaceId: group.workspaceId,
      workspaceName: group.workspaceName,
    };
  });

  blockers.sort((left, right) => {
    const byWorkspace = left.workspaceName.localeCompare(right.workspaceName);
    if (byWorkspace !== 0) return byWorkspace;
    const leftItem = left.itemKey ?? left.itemTitle;
    const rightItem = right.itemKey ?? right.itemTitle;
    const byItem = leftItem.localeCompare(rightItem);
    if (byItem !== 0) return byItem;
    return left.entityId.localeCompare(right.entityId);
  });
  return blockers;
}

/**
 * Permanently delete a workspace. Cross-workspace item media is reported
 * instead of surfacing a foreign-key error. Links owned by this workspace's
 * projects are removed first so ON DELETE RESTRICT cannot fire while the
 * workspace cascade deletes those projects' media.
 */
export async function purgeWorkspace(database: Database, workspaceId: string): Promise<void> {
  const blockers = await findWorkspacePurgeBlockers(database, workspaceId);
  if (blockers.length > 0) {
    throw new AppError({
      code: 'WORKSPACE_PURGE_BLOCKED',
      message: formatWorkspacePurgeMessage(blockers),
      statusCode: 409,
      details: { blockers },
    });
  }

  await database.db.transaction(async (tx) => {
    await tx
      .delete(projectItemMediaLinks)
      .where(
        inArray(
          projectItemMediaLinks.projectId,
          tx
            .select({ id: projects.id })
            .from(projects)
            .where(eq(projects.workspaceId, workspaceId)),
        ),
      );
    await tx.delete(workspaces).where(eq(workspaces.id, workspaceId));
  });
}
