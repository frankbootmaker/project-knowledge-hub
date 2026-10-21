import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Database } from '@project-knowledge-hub/database';
import {
  projectDeliveryDependencies,
  projectEpics,
  projectMilestoneItemLinks,
  projectMilestones,
  projectSprints,
  projectTasks,
  projectUserStories,
} from '@project-knowledge-hub/database';
import {
  AppError,
  deliveryCompletionIndex,
  displayedParentCompletion,
  displayedTaskCompletionPercent,
  milestoneCompletion,
  taskItemTypeSchema,
  type DeliveryCompletionRollup,
  type MilestoneLinkCompletion,
} from '@project-knowledge-hub/domain';
import { diffReplacement } from './replace-diff.js';
import { recomputeDeliveryParentStatuses } from './parent-status.js';
import { rescheduleDeliveryFrom } from './delivery-dependencies.js';
import { archivedDeliveryLinkError, deliveryKeyLabel } from './delivery-archive.js';
import { toHumanKeyFields } from './project-issue-keys.js';

export type MilestoneCompletionFields = {
  completionPercent: number | null;
  completion: DeliveryCompletionRollup | null;
  linkedItems: PublicMilestoneLink[];
};

export const MILESTONE_LINK_ENTITY_TYPES = ['epic', 'user_story', 'task'] as const;
export type MilestoneLinkEntityType = (typeof MILESTONE_LINK_ENTITY_TYPES)[number];

export type PublicMilestoneLink = {
  entityType: MilestoneLinkEntityType;
  entityId: string;
  /** Set on tasks. Bugs use itemType bug. */
  itemType: 'task' | 'bug' | null;
  title: string;
  humanKey: string | null;
  status: string;
  /** Shown percent. Done is 100, cancelled is 0, otherwise computed or null. */
  completionPercent: number | null;
};

export type MilestoneLinkInput = {
  entityType: MilestoneLinkEntityType;
  entityId: string;
};

function isLinkEntityType(value: string): value is MilestoneLinkEntityType {
  return (MILESTONE_LINK_ENTITY_TYPES as readonly string[]).includes(value);
}

function rollupFields(
  rollup: DeliveryCompletionRollup | null,
): Pick<MilestoneCompletionFields, 'completionPercent' | 'completion'> {
  if (!rollup) return { completionPercent: null, completion: null };
  return { completionPercent: rollup.percent, completion: rollup };
}

type LinkSource = {
  entityType: MilestoneLinkEntityType;
  entityId: string;
  itemType: 'task' | 'bug' | null;
  title: string;
  humanKey: string | null;
  status: string;
  displayedPercent: number | null;
  rollup: MilestoneLinkCompletion;
};

export async function deleteMilestoneItemLinks(
  database: Database,
  entityType: MilestoneLinkEntityType,
  entityIds: string[],
): Promise<void> {
  if (entityIds.length === 0) return;
  await database.db
    .delete(projectMilestoneItemLinks)
    .where(
      and(
        eq(projectMilestoneItemLinks.entityType, entityType),
        inArray(projectMilestoneItemLinks.entityId, entityIds),
      ),
    );
}

export async function withMilestoneLinks<T extends { id: string }>(
  database: Database,
  projectId: string,
  keyPrefix: string | null | undefined,
  milestones: T[],
): Promise<Array<T & MilestoneCompletionFields>> {
  if (milestones.length === 0) return [];
  const milestoneIds = milestones.map((row) => row.id);
  const linkRows = await database.db
    .select({
      milestoneId: projectMilestoneItemLinks.milestoneId,
      entityType: projectMilestoneItemLinks.entityType,
      entityId: projectMilestoneItemLinks.entityId,
    })
    .from(projectMilestoneItemLinks)
    .where(inArray(projectMilestoneItemLinks.milestoneId, milestoneIds));

  const sources = await loadLinkSources(database, projectId, keyPrefix, linkRows);
  const predecessorPoints = await loadPredecessorPoints(database, projectId, milestoneIds);
  const byMilestone = new Map<string, PublicMilestoneLink[]>();
  const rollupByMilestone = new Map<string, MilestoneLinkCompletion[]>();
  for (const row of linkRows) {
    if (!isLinkEntityType(row.entityType)) continue;
    const source = sources.get(`${row.entityType}:${row.entityId}`);
    if (!source) continue;
    const list = byMilestone.get(row.milestoneId) ?? [];
    list.push({
      entityType: source.entityType,
      entityId: source.entityId,
      itemType: source.itemType,
      title: source.title,
      humanKey: source.humanKey,
      status: source.status,
      completionPercent: source.displayedPercent,
    });
    byMilestone.set(row.milestoneId, list);
    const points = rollupByMilestone.get(row.milestoneId) ?? [];
    points.push(source.rollup);
    rollupByMilestone.set(row.milestoneId, points);
  }

  return milestones.map((milestone) => {
    const linkedItems = byMilestone.get(milestone.id) ?? [];
    linkedItems.sort((a, b) =>
      (a.humanKey ?? a.title).localeCompare(b.humanKey ?? b.title),
    );
    return {
      ...milestone,
      linkedItems,
      ...rollupFields(milestoneCompletion([
        ...(rollupByMilestone.get(milestone.id) ?? []),
        ...(predecessorPoints.get(milestone.id) ?? []),
      ])),
    };
  });
}

async function loadLinkSources(
  database: Database,
  projectId: string,
  keyPrefix: string | null | undefined,
  linkRows: Array<{ entityType: string; entityId: string }>,
): Promise<Map<string, LinkSource>> {
  const idsFor = (entityType: MilestoneLinkEntityType) =>
    linkRows.filter((row) => row.entityType === entityType).map((row) => row.entityId);
  const epicIds = [...new Set(idsFor('epic'))];
  const storyIds = [...new Set(idsFor('user_story'))];
  const taskIds = [...new Set(idsFor('task'))];
  const needsParentRollup = epicIds.length > 0 || storyIds.length > 0;

  const [epics, stories, tasks, childTasks] = await Promise.all([
    epicIds.length === 0
      ? Promise.resolve([])
      : database.db
          .select({
            id: projectEpics.id,
            title: projectEpics.title,
            status: projectEpics.status,
            issueKeyType: projectEpics.issueKeyType,
            issueNumber: projectEpics.issueNumber,
          })
          .from(projectEpics)
          .where(
            and(eq(projectEpics.projectId, projectId), inArray(projectEpics.id, epicIds)),
          ),
    storyIds.length === 0
      ? Promise.resolve([])
      : database.db
          .select({
            id: projectUserStories.id,
            title: projectUserStories.title,
            status: projectUserStories.status,
            issueKeyType: projectUserStories.issueKeyType,
            issueNumber: projectUserStories.issueNumber,
          })
          .from(projectUserStories)
          .where(
            and(
              eq(projectUserStories.projectId, projectId),
              inArray(projectUserStories.id, storyIds),
            ),
          ),
    taskIds.length === 0
      ? Promise.resolve([])
      : database.db
          .select({
            id: projectTasks.id,
            title: projectTasks.title,
            status: projectTasks.status,
            itemType: projectTasks.itemType,
            completionPercent: projectTasks.completionPercent,
            issueKeyType: projectTasks.issueKeyType,
            issueNumber: projectTasks.issueNumber,
          })
          .from(projectTasks)
          .where(
            and(eq(projectTasks.projectId, projectId), inArray(projectTasks.id, taskIds)),
          ),
    needsParentRollup
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
          .where(
            and(eq(projectTasks.projectId, projectId), isNull(projectTasks.archivedAt)),
          )
      : Promise.resolve([]),
  ]);

  const index = deliveryCompletionIndex(childTasks);
  const sources = new Map<string, LinkSource>();
  for (const epic of epics) {
    const raw = index.byEpicId.get(epic.id) ?? null;
    const shown = displayedParentCompletion(epic.status, raw);
    const keys = toHumanKeyFields(keyPrefix, epic.issueKeyType, epic.issueNumber);
    sources.set(`epic:${epic.id}`, {
      entityType: 'epic',
      entityId: epic.id,
      itemType: null,
      title: epic.title,
      humanKey: keys.humanKey,
      status: epic.status,
      displayedPercent: shown?.percent ?? null,
      rollup: {
        kind: 'parent',
        status: epic.status,
        completionPercent: raw?.percent ?? null,
      },
    });
  }
  for (const story of stories) {
    const raw = index.byStoryId.get(story.id) ?? null;
    const shown = displayedParentCompletion(story.status, raw);
    const keys = toHumanKeyFields(keyPrefix, story.issueKeyType, story.issueNumber);
    sources.set(`user_story:${story.id}`, {
      entityType: 'user_story',
      entityId: story.id,
      itemType: null,
      title: story.title,
      humanKey: keys.humanKey,
      status: story.status,
      displayedPercent: shown?.percent ?? null,
      rollup: {
        kind: 'parent',
        status: story.status,
        completionPercent: raw?.percent ?? null,
      },
    });
  }
  for (const task of tasks) {
    const itemType = taskItemTypeSchema.safeParse(task.itemType);
    const keys = toHumanKeyFields(keyPrefix, task.issueKeyType, task.issueNumber);
    sources.set(`task:${task.id}`, {
      entityType: 'task',
      entityId: task.id,
      itemType: itemType.success ? itemType.data : 'task',
      title: task.title,
      humanKey: keys.humanKey,
      status: task.status,
      displayedPercent: displayedTaskCompletionPercent(task.status, task.completionPercent),
      rollup: {
        kind: 'task',
        status: task.status,
        completionPercent: task.completionPercent,
      },
    });
  }
  return sources;
}

function predecessorPoint(
  status: string,
  completionPercent: number | null,
): MilestoneLinkCompletion {
  if (status === 'cancelled') {
    return { kind: 'task', status: 'cancelled', completionPercent: 0 };
  }
  if (status === 'done' || status === 'completed' || completionPercent === 100) {
    return { kind: 'task', status: 'done', completionPercent: 100 };
  }
  return { kind: 'task', status: 'in_progress', completionPercent: 0 };
}

/** Predecessor dependencies count toward the 0-or-100 milestone percent. */
async function loadPredecessorPoints(
  database: Database,
  projectId: string,
  milestoneIds: string[],
): Promise<Map<string, MilestoneLinkCompletion[]>> {
  const deps = await database.db
    .select({
      successorId: projectDeliveryDependencies.successorId,
      predecessorType: projectDeliveryDependencies.predecessorType,
      predecessorId: projectDeliveryDependencies.predecessorId,
    })
    .from(projectDeliveryDependencies)
    .where(
      and(
        eq(projectDeliveryDependencies.projectId, projectId),
        eq(projectDeliveryDependencies.successorType, 'milestone'),
        inArray(projectDeliveryDependencies.successorId, milestoneIds),
      ),
    );
  const byMilestone = new Map<string, MilestoneLinkCompletion[]>();
  if (deps.length === 0) return byMilestone;

  const idsFor = (entityType: string) => [
    ...new Set(
      deps
        .filter((row) => row.predecessorType === entityType)
        .map((row) => row.predecessorId),
    ),
  ];
  const taskIds = idsFor('task');
  const epicIds = idsFor('epic');
  const storyIds = idsFor('user_story');
  const milestonePredIds = idsFor('milestone');
  const sprintIds = idsFor('sprint');
  const needsParents = epicIds.length > 0 || storyIds.length > 0;

  const [tasks, epics, stories, milestoneRows, sprints, childTasks] = await Promise.all([
    taskIds.length === 0
      ? Promise.resolve([])
      : database.db
          .select({
            id: projectTasks.id,
            status: projectTasks.status,
            completionPercent: projectTasks.completionPercent,
          })
          .from(projectTasks)
          .where(and(eq(projectTasks.projectId, projectId), inArray(projectTasks.id, taskIds))),
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
    milestonePredIds.length === 0
      ? Promise.resolve([])
      : database.db
          .select({ id: projectMilestones.id, status: projectMilestones.status })
          .from(projectMilestones)
          .where(
            and(
              eq(projectMilestones.projectId, projectId),
              inArray(projectMilestones.id, milestonePredIds),
            ),
          ),
    sprintIds.length === 0
      ? Promise.resolve([])
      : database.db
          .select({ id: projectSprints.id, status: projectSprints.status })
          .from(projectSprints)
          .where(
            and(eq(projectSprints.projectId, projectId), inArray(projectSprints.id, sprintIds)),
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
          .leftJoin(projectUserStories, eq(projectTasks.userStoryId, projectUserStories.id))
          .where(and(eq(projectTasks.projectId, projectId), isNull(projectTasks.archivedAt)))
      : Promise.resolve([]),
  ]);

  const index = deliveryCompletionIndex(childTasks);
  const known = new Map<string, { status: string; completionPercent: number | null }>();
  for (const task of tasks) {
    known.set(`task:${task.id}`, {
      status: task.status,
      completionPercent: task.completionPercent,
    });
  }
  for (const epic of epics) {
    known.set(`epic:${epic.id}`, {
      status: epic.status,
      completionPercent: index.byEpicId.get(epic.id)?.percent ?? null,
    });
  }
  for (const story of stories) {
    known.set(`user_story:${story.id}`, {
      status: story.status,
      completionPercent: index.byStoryId.get(story.id)?.percent ?? null,
    });
  }
  for (const milestone of milestoneRows) {
    known.set(`milestone:${milestone.id}`, {
      status: milestone.status,
      completionPercent: milestone.status === 'done' ? 100 : 0,
    });
  }
  for (const sprint of sprints) {
    known.set(`sprint:${sprint.id}`, {
      status: sprint.status,
      completionPercent: sprint.status === 'completed' ? 100 : 0,
    });
  }

  for (const dep of deps) {
    const item = known.get(`${dep.predecessorType}:${dep.predecessorId}`);
    if (!item) continue;
    const list = byMilestone.get(dep.successorId) ?? [];
    list.push(predecessorPoint(item.status, item.completionPercent));
    byMilestone.set(dep.successorId, list);
  }
  return byMilestone;
}

export async function setMilestoneItemLinks(
  database: Database,
  input: {
    milestoneId: string;
    projectId: string;
    items: MilestoneLinkInput[];
    createdBy?: string | null;
  },
): Promise<void> {
  const [milestone] = await database.db
    .select({
      id: projectMilestones.id,
      projectId: projectMilestones.projectId,
      title: projectMilestones.title,
      archivedAt: projectMilestones.archivedAt,
      issueKeyType: projectMilestones.issueKeyType,
      issueNumber: projectMilestones.issueNumber,
    })
    .from(projectMilestones)
    .where(eq(projectMilestones.id, input.milestoneId))
    .limit(1);
  if (!milestone || milestone.projectId !== input.projectId) {
    throw new AppError({
      code: 'MILESTONE_NOT_FOUND',
      message: 'Milestone not found',
      statusCode: 404,
    });
  }
  if (milestone.archivedAt) {
    const label = await deliveryKeyLabel(
      database,
      input.projectId,
      milestone.issueKeyType,
      milestone.issueNumber,
      milestone.title,
    );
    throw archivedDeliveryLinkError('milestone', label);
  }

  const unique = new Map<string, MilestoneLinkInput>();
  for (const item of input.items) {
    if (!isLinkEntityType(item.entityType)) continue;
    unique.set(`${item.entityType}:${item.entityId}`, item);
  }
  const items = [...unique.values()];
  await assertSameProject(database, input.projectId, items);

  await database.db.transaction(async (tx) => {
    const existing = await tx
      .select({
        id: projectMilestoneItemLinks.id,
        entityType: projectMilestoneItemLinks.entityType,
        entityId: projectMilestoneItemLinks.entityId,
      })
      .from(projectMilestoneItemLinks)
      .where(eq(projectMilestoneItemLinks.milestoneId, input.milestoneId));
    const diff = diffReplacement(
      existing,
      items,
      (row) => `${row.entityType}:${row.entityId}`,
      (row) => `${row.entityType}:${row.entityId}`,
      () => true,
    );
    if (diff.remove.length > 0) {
      await tx
        .delete(projectMilestoneItemLinks)
        .where(
          inArray(
            projectMilestoneItemLinks.id,
            diff.remove.map((row) => row.id),
          ),
        );
    }
    if (diff.insert.length > 0) {
      await tx.insert(projectMilestoneItemLinks).values(
        diff.insert.map((row) => ({
          milestoneId: input.milestoneId,
          entityType: row.entityType,
          entityId: row.entityId,
          createdBy: input.createdBy ?? null,
        })),
      );
    }
  });
  const applied = await recomputeDeliveryParentStatuses(database, input.projectId, {
    milestoneIds: [input.milestoneId],
  });
  await rescheduleDeliveryFrom(database, input.projectId, [
    { entityType: 'milestone', id: input.milestoneId },
    ...applied.dateChanges,
  ]);
}

async function assertSameProject(
  database: Database,
  projectId: string,
  items: MilestoneLinkInput[],
): Promise<void> {
  const idsFor = (entityType: MilestoneLinkEntityType) =>
    items.filter((item) => item.entityType === entityType).map((item) => item.entityId);
  const checks: Array<Promise<number>> = [];
  const expectCount = (entityType: MilestoneLinkEntityType, found: number) => {
    const wanted = idsFor(entityType).length;
    if (found !== wanted) {
      throw new AppError({
        code: 'MILESTONE_LINK_NOT_IN_PROJECT',
        message: 'Linked items must belong to the milestone project',
        statusCode: 400,
      });
    }
  };
  if (idsFor('epic').length > 0) {
    checks.push(
      database.db
        .select({ id: projectEpics.id })
        .from(projectEpics)
        .where(
          and(
            eq(projectEpics.projectId, projectId),
            inArray(projectEpics.id, idsFor('epic')),
          ),
        )
        .then((rows) => {
          expectCount('epic', rows.length);
          return rows.length;
        }),
    );
  }
  if (idsFor('user_story').length > 0) {
    checks.push(
      database.db
        .select({ id: projectUserStories.id })
        .from(projectUserStories)
        .where(
          and(
            eq(projectUserStories.projectId, projectId),
            inArray(projectUserStories.id, idsFor('user_story')),
          ),
        )
        .then((rows) => {
          expectCount('user_story', rows.length);
          return rows.length;
        }),
    );
  }
  if (idsFor('task').length > 0) {
    checks.push(
      database.db
        .select({ id: projectTasks.id })
        .from(projectTasks)
        .where(
          and(
            eq(projectTasks.projectId, projectId),
            inArray(projectTasks.id, idsFor('task')),
          ),
        )
        .then((rows) => {
          expectCount('task', rows.length);
          return rows.length;
        }),
    );
  }
  await Promise.all(checks);
}
