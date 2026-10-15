import { and, eq, inArray, isNull, or, type SQL } from 'drizzle-orm';
import type { Database } from '@project-knowledge-hub/database';
import {
  projectEpics,
  projectMilestoneItemLinks,
  projectMilestones,
  projectTasks,
  projectUserStories,
} from '@project-knowledge-hub/database';
import {
  childCompletionPoints,
  deliveryCompletionIndex,
  derivedParentStatus,
  milestoneLinkPoints,
  type MilestoneLinkCompletion,
  type ParentStatusSource,
} from '@project-knowledge-hub/domain';

export type RecomputedParentStatuses = {
  stories: Map<string, string>;
  epics: Map<string, string>;
  milestones: Map<string, string>;
};

type IdInput = {
  storyIds?: Array<string | null | undefined>;
  epicIds?: Array<string | null | undefined>;
  taskIds?: Array<string | null | undefined>;
  milestoneIds?: Array<string | null | undefined>;
};

function uniqueIds(values: Array<string | null | undefined> | undefined): string[] {
  return [...new Set((values ?? []).filter((id): id is string => Boolean(id)))];
}

function anyOf(conditions: SQL[]): SQL | undefined {
  if (conditions.length === 0) return undefined;
  if (conditions.length === 1) return conditions[0];
  return or(...conditions);
}

function taskSource(task: {
  status: string;
  completionPercent: number | null;
}): ParentStatusSource {
  return {
    status: task.status,
    points: childCompletionPoints(task.status, task.completionPercent),
  };
}

async function writeStatus(
  database: Database,
  table: typeof projectUserStories | typeof projectEpics | typeof projectMilestones,
  changes: Array<{ id: string; status: string }>,
): Promise<void> {
  const byStatus = new Map<string, string[]>();
  for (const change of changes) {
    const ids = byStatus.get(change.status) ?? [];
    ids.push(change.id);
    byStatus.set(change.status, ids);
  }
  const updatedAt = new Date();
  for (const [status, ids] of byStatus) {
    await database.db
      .update(table)
      .set({ status, updatedAt })
      .where(inArray(table.id, ids));
  }
}

/** Milestones whose links mention these items. Captured before a link is removed. */
export async function milestoneIdsForDeliveryEntities(
  database: Database,
  projectId: string,
  input: IdInput,
): Promise<string[]> {
  const storyIds = uniqueIds(input.storyIds);
  const epicIds = uniqueIds(input.epicIds);
  const taskIds = uniqueIds(input.taskIds);
  const explicit = uniqueIds(input.milestoneIds);
  const matchers: SQL[] = [];
  if (explicit.length > 0) {
    matchers.push(inArray(projectMilestones.id, explicit));
  }
  if (storyIds.length > 0) {
    matchers.push(
      and(
        eq(projectMilestoneItemLinks.entityType, 'user_story'),
        inArray(projectMilestoneItemLinks.entityId, storyIds),
      )!,
    );
  }
  if (epicIds.length > 0) {
    matchers.push(
      and(
        eq(projectMilestoneItemLinks.entityType, 'epic'),
        inArray(projectMilestoneItemLinks.entityId, epicIds),
      )!,
    );
  }
  if (taskIds.length > 0) {
    matchers.push(
      and(
        eq(projectMilestoneItemLinks.entityType, 'task'),
        inArray(projectMilestoneItemLinks.entityId, taskIds),
      )!,
    );
  }
  const match = anyOf(matchers);
  if (!match) return [];
  const rows = await database.db
    .select({ id: projectMilestones.id })
    .from(projectMilestones)
    .leftJoin(
      projectMilestoneItemLinks,
      eq(projectMilestoneItemLinks.milestoneId, projectMilestones.id),
    )
    .where(and(eq(projectMilestones.projectId, projectId), match));
  return [...new Set(rows.map((row) => row.id))];
}

/**
 * Persist story, epic, and milestone status from included children.
 * A parent with no included children is left unchanged.
 */
export async function recomputeDeliveryParentStatuses(
  database: Database,
  projectId: string,
  input: IdInput,
): Promise<RecomputedParentStatuses> {
  const stories = new Map<string, string>();
  const epics = new Map<string, string>();
  const milestones = new Map<string, string>();
  const storyIds = uniqueIds(input.storyIds);
  const epicIds = new Set(uniqueIds(input.epicIds));
  const taskIds = uniqueIds(input.taskIds);

  const storyRows =
    storyIds.length === 0
      ? []
      : await database.db
          .select({
            id: projectUserStories.id,
            status: projectUserStories.status,
            epicId: projectUserStories.epicId,
          })
          .from(projectUserStories)
          .where(
            and(
              eq(projectUserStories.projectId, projectId),
              inArray(projectUserStories.id, storyIds),
            ),
          );
  for (const story of storyRows) epicIds.add(story.epicId);

  const epicIdList = [...epicIds];
  const epicRows =
    epicIdList.length === 0
      ? []
      : await database.db
          .select({ id: projectEpics.id, status: projectEpics.status })
          .from(projectEpics)
          .where(
            and(eq(projectEpics.projectId, projectId), inArray(projectEpics.id, epicIdList)),
          );

  const storyIdSet = new Set(storyRows.map((row) => row.id));
  const epicIdSet = new Set(epicRows.map((row) => row.id));
  const taskMatch = anyOf([
    ...(storyIdSet.size > 0
      ? [inArray(projectTasks.userStoryId, [...storyIdSet])]
      : []),
    ...(epicIdSet.size > 0
      ? [inArray(projectUserStories.epicId, [...epicIdSet])]
      : []),
  ]);
  const taskRows = taskMatch
    ? await database.db
        .select({
          status: projectTasks.status,
          completionPercent: projectTasks.completionPercent,
          userStoryId: projectTasks.userStoryId,
          epicId: projectUserStories.epicId,
        })
        .from(projectTasks)
        .leftJoin(
          projectUserStories,
          eq(projectTasks.userStoryId, projectUserStories.id),
        )
        .where(
          and(
            eq(projectTasks.projectId, projectId),
            isNull(projectTasks.archivedAt),
            taskMatch,
          ),
        )
    : [];

  const sourcesByStory = new Map<string, ParentStatusSource[]>();
  const sourcesByEpic = new Map<string, ParentStatusSource[]>();
  for (const task of taskRows) {
    const source = taskSource(task);
    if (task.userStoryId && storyIdSet.has(task.userStoryId)) {
      const list = sourcesByStory.get(task.userStoryId) ?? [];
      list.push(source);
      sourcesByStory.set(task.userStoryId, list);
    }
    if (task.epicId && epicIdSet.has(task.epicId)) {
      const list = sourcesByEpic.get(task.epicId) ?? [];
      list.push(source);
      sourcesByEpic.set(task.epicId, list);
    }
  }

  const storyChanges: Array<{ id: string; status: string }> = [];
  for (const story of storyRows) {
    const derived = derivedParentStatus(sourcesByStory.get(story.id) ?? []);
    const next = derived ?? story.status;
    stories.set(story.id, next);
    if (derived != null && derived !== story.status) {
      storyChanges.push({ id: story.id, status: derived });
    }
  }
  const epicChanges: Array<{ id: string; status: string }> = [];
  for (const epic of epicRows) {
    const derived = derivedParentStatus(sourcesByEpic.get(epic.id) ?? []);
    const next = derived ?? epic.status;
    epics.set(epic.id, next);
    if (derived != null && derived !== epic.status) {
      epicChanges.push({ id: epic.id, status: derived });
    }
  }
  await writeStatus(database, projectUserStories, storyChanges);
  await writeStatus(database, projectEpics, epicChanges);

  const milestoneIds = await milestoneIdsForDeliveryEntities(database, projectId, {
    storyIds: [...storyIdSet],
    epicIds: [...epicIdSet],
    taskIds,
    milestoneIds: input.milestoneIds,
  });
  if (milestoneIds.length === 0) return { stories, epics, milestones };

  await recomputeMilestones(database, projectId, milestoneIds, milestones);
  return { stories, epics, milestones };
}

async function recomputeMilestones(
  database: Database,
  projectId: string,
  milestoneIds: string[],
  into: Map<string, string>,
): Promise<void> {
  const milestoneRows = await database.db
    .select({ id: projectMilestones.id, status: projectMilestones.status })
    .from(projectMilestones)
    .where(
      and(
        eq(projectMilestones.projectId, projectId),
        inArray(projectMilestones.id, milestoneIds),
      ),
    );
  if (milestoneRows.length === 0) return;
  const ids = milestoneRows.map((row) => row.id);
  const linkRows = await database.db
    .select({
      milestoneId: projectMilestoneItemLinks.milestoneId,
      entityType: projectMilestoneItemLinks.entityType,
      entityId: projectMilestoneItemLinks.entityId,
    })
    .from(projectMilestoneItemLinks)
    .where(inArray(projectMilestoneItemLinks.milestoneId, ids));

  const idsFor = (entityType: string) =>
    linkRows.filter((row) => row.entityType === entityType).map((row) => row.entityId);
  const epicIds = [...new Set(idsFor('epic'))];
  const storyIds = [...new Set(idsFor('user_story'))];
  const linkedTaskIds = [...new Set(idsFor('task'))];
  const needsParents = epicIds.length > 0 || storyIds.length > 0;

  const [epicRows, storyRows, taskRows, childTasks] = await Promise.all([
    epicIds.length === 0
      ? Promise.resolve([])
      : database.db
          .select({ id: projectEpics.id, status: projectEpics.status })
          .from(projectEpics)
          .where(and(eq(projectEpics.projectId, projectId), inArray(projectEpics.id, epicIds))),
    storyIds.length === 0
      ? Promise.resolve([])
      : database.db
          .select({ id: projectUserStories.id, status: projectUserStories.status })
          .from(projectUserStories)
          .where(
            and(
              eq(projectUserStories.projectId, projectId),
              inArray(projectUserStories.id, storyIds),
            ),
          ),
    linkedTaskIds.length === 0
      ? Promise.resolve([])
      : database.db
          .select({
            id: projectTasks.id,
            status: projectTasks.status,
            completionPercent: projectTasks.completionPercent,
          })
          .from(projectTasks)
          .where(
            and(eq(projectTasks.projectId, projectId), inArray(projectTasks.id, linkedTaskIds)),
          ),
    needsParents
      ? database.db
          .select({
            status: projectTasks.status,
            completionPercent: projectTasks.completionPercent,
            userStoryId: projectTasks.userStoryId,
            epicId: projectUserStories.epicId,
          })
          .from(projectTasks)
          .leftJoin(
            projectUserStories,
            eq(projectTasks.userStoryId, projectUserStories.id),
          )
          .where(and(eq(projectTasks.projectId, projectId), isNull(projectTasks.archivedAt)))
      : Promise.resolve([]),
  ]);

  const rollup = deliveryCompletionIndex(childTasks);
  const epicById = new Map(epicRows.map((row) => [row.id, row]));
  const storyById = new Map(storyRows.map((row) => [row.id, row]));
  const taskById = new Map(taskRows.map((row) => [row.id, row]));
  const linksByMilestone = new Map<string, MilestoneLinkCompletion[]>();
  for (const link of linkRows) {
    const completion = linkCompletion(link, epicById, storyById, taskById, rollup);
    if (!completion) continue;
    const list = linksByMilestone.get(link.milestoneId) ?? [];
    list.push(completion);
    linksByMilestone.set(link.milestoneId, list);
  }

  const changes: Array<{ id: string; status: string }> = [];
  for (const milestone of milestoneRows) {
    const derived = derivedParentStatus(
      (linksByMilestone.get(milestone.id) ?? []).map((link) => ({
        status: link.status,
        points: milestoneLinkPoints(link),
      })),
    );
    const next = derived ?? milestone.status;
    into.set(milestone.id, next);
    if (derived != null && derived !== milestone.status) {
      changes.push({ id: milestone.id, status: derived });
    }
  }
  await writeStatus(database, projectMilestones, changes);
}

function linkCompletion(
  link: { entityType: string; entityId: string },
  epics: Map<string, { status: string }>,
  stories: Map<string, { status: string }>,
  tasks: Map<string, { status: string; completionPercent: number | null }>,
  rollup: ReturnType<typeof deliveryCompletionIndex>,
): MilestoneLinkCompletion | null {
  if (link.entityType === 'task') {
    const task = tasks.get(link.entityId);
    if (!task) return null;
    return {
      kind: 'task',
      status: task.status,
      completionPercent: task.completionPercent,
    };
  }
  if (link.entityType === 'user_story') {
    const story = stories.get(link.entityId);
    if (!story) return null;
    return {
      kind: 'parent',
      status: story.status,
      completionPercent: rollup.byStoryId.get(link.entityId)?.percent ?? null,
    };
  }
  if (link.entityType === 'epic') {
    const epic = epics.get(link.entityId);
    if (!epic) return null;
    return {
      kind: 'parent',
      status: epic.status,
      completionPercent: rollup.byEpicId.get(link.entityId)?.percent ?? null,
    };
  }
  return null;
}
