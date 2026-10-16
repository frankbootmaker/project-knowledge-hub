import { and, eq, inArray, isNotNull, isNull, ne, or, type SQL } from 'drizzle-orm';
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
  deliveryItemKey,
  derivedParentDates,
  derivedParentStatus,
  milestoneLinkPoints,
  type DeliveryDependencyEntityType,
  type MilestoneLinkCompletion,
  type ParentDateSource,
  type ParentDateSpan,
  type ParentStatusSource,
} from '@project-knowledge-hub/domain';

export type RecomputedParentStatuses = {
  stories: Map<string, string>;
  epics: Map<string, string>;
  milestones: Map<string, string>;
  dates: {
    stories: Map<string, ParentDateSpan>;
    epics: Map<string, ParentDateSpan>;
    milestones: Map<string, ParentDateSpan>;
  };
  /** Parents whose start or end was rewritten. */
  dateChanges: Array<{ entityType: DeliveryDependencyEntityType; id: string }>;
};

type IdInput = {
  storyIds?: Array<string | null | undefined>;
  epicIds?: Array<string | null | undefined>;
  taskIds?: Array<string | null | undefined>;
  milestoneIds?: Array<string | null | undefined>;
  /** Recompute every story, epic, and milestone on the project. */
  projectScope?: boolean;
};

function emptyRecompute(): RecomputedParentStatuses {
  return {
    stories: new Map(),
    epics: new Map(),
    milestones: new Map(),
    dates: { stories: new Map(), epics: new Map(), milestones: new Map() },
    dateChanges: [],
  };
}

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

async function writeStoryDates(
  database: Database,
  changes: Array<{ id: string; start: string | null; end: string | null }>,
): Promise<void> {
  const updatedAt = new Date();
  for (const change of changes) {
    await database.db
      .update(projectUserStories)
      .set({ startDate: change.start, endDate: change.end, updatedAt })
      .where(eq(projectUserStories.id, change.id));
  }
}

async function writeEpicDates(
  database: Database,
  changes: Array<{ id: string; start: string | null; end: string | null }>,
): Promise<void> {
  const updatedAt = new Date();
  for (const change of changes) {
    await database.db
      .update(projectEpics)
      .set({ startDate: change.start, endDate: change.end, updatedAt })
      .where(eq(projectEpics.id, change.id));
  }
}

function rememberDates(
  into: Map<string, ParentDateSpan>,
  changes: RecomputedParentStatuses['dateChanges'],
  entityType: DeliveryDependencyEntityType,
  id: string,
  current: ParentDateSpan,
  next: ParentDateSpan,
): void {
  into.set(id, next);
  if (next.start !== current.start || next.end !== current.end) {
    changes.push({ entityType, id });
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
  const result = emptyRecompute();
  const { stories, epics, dates, dateChanges } = result;
  let storyIds = uniqueIds(input.storyIds);
  const epicIds = new Set(uniqueIds(input.epicIds));
  let milestoneIdInput = uniqueIds(input.milestoneIds);
  const taskIds = uniqueIds(input.taskIds);

  if (input.projectScope) {
    const [allStories, allEpics, allMilestones] = await Promise.all([
      database.db
        .select({ id: projectUserStories.id })
        .from(projectUserStories)
        .where(eq(projectUserStories.projectId, projectId)),
      database.db
        .select({ id: projectEpics.id })
        .from(projectEpics)
        .where(eq(projectEpics.projectId, projectId)),
      database.db
        .select({ id: projectMilestones.id })
        .from(projectMilestones)
        .where(eq(projectMilestones.projectId, projectId)),
    ]);
    storyIds = uniqueIds([...storyIds, ...allStories.map((row) => row.id)]);
    for (const row of allEpics) epicIds.add(row.id);
    milestoneIdInput = uniqueIds([
      ...milestoneIdInput,
      ...allMilestones.map((row) => row.id),
    ]);
  }

  const storyRows =
    storyIds.length === 0
      ? []
      : await database.db
          .select({
            id: projectUserStories.id,
            status: projectUserStories.status,
            epicId: projectUserStories.epicId,
            startDate: projectUserStories.startDate,
            endDate: projectUserStories.endDate,
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
          .select({
            id: projectEpics.id,
            status: projectEpics.status,
            startDate: projectEpics.startDate,
            endDate: projectEpics.endDate,
          })
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
          startDate: projectTasks.startDate,
          dueDate: projectTasks.dueDate,
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
  const datesByStory = new Map<string, ParentDateSource[]>();
  for (const task of taskRows) {
    const source = taskSource(task);
    if (task.userStoryId && storyIdSet.has(task.userStoryId)) {
      const list = sourcesByStory.get(task.userStoryId) ?? [];
      list.push(source);
      sourcesByStory.set(task.userStoryId, list);
      const dated = datesByStory.get(task.userStoryId) ?? [];
      dated.push({ status: task.status, start: task.startDate, end: task.dueDate });
      datesByStory.set(task.userStoryId, dated);
    }
    if (task.epicId && epicIdSet.has(task.epicId)) {
      const list = sourcesByEpic.get(task.epicId) ?? [];
      list.push(source);
      sourcesByEpic.set(task.epicId, list);
    }
  }

  const storyChanges: Array<{ id: string; status: string }> = [];
  const storyDateChanges: Array<{ id: string; start: string | null; end: string | null }> = [];
  for (const story of storyRows) {
    const derived = derivedParentStatus(sourcesByStory.get(story.id) ?? []);
    const next = derived ?? story.status;
    stories.set(story.id, next);
    if (derived != null && derived !== story.status) {
      storyChanges.push({ id: story.id, status: derived });
    }
    const span = derivedParentDates(
      { start: story.startDate, end: story.endDate },
      datesByStory.get(story.id) ?? [],
    );
    rememberDates(
      dates.stories,
      dateChanges,
      'user_story',
      story.id,
      { start: story.startDate, end: story.endDate },
      span,
    );
    if (span.start !== story.startDate || span.end !== story.endDate) {
      storyDateChanges.push({ id: story.id, start: span.start, end: span.end });
    }
  }
  await writeStatus(database, projectUserStories, storyChanges);
  await writeStoryDates(database, storyDateChanges);

  const epicStoryRows =
    epicIdSet.size === 0
      ? []
      : await database.db
          .select({
            id: projectUserStories.id,
            epicId: projectUserStories.epicId,
            status: projectUserStories.status,
            startDate: projectUserStories.startDate,
            endDate: projectUserStories.endDate,
          })
          .from(projectUserStories)
          .where(
            and(
              eq(projectUserStories.projectId, projectId),
              inArray(projectUserStories.epicId, [...epicIdSet]),
              isNull(projectUserStories.archivedAt),
            ),
          );
  const datesByEpic = new Map<string, ParentDateSource[]>();
  for (const story of epicStoryRows) {
    const span = dates.stories.get(story.id);
    const list = datesByEpic.get(story.epicId) ?? [];
    list.push({
      status: stories.get(story.id) ?? story.status,
      start: span?.start ?? story.startDate,
      end: span?.end ?? story.endDate,
    });
    datesByEpic.set(story.epicId, list);
  }

  const epicChanges: Array<{ id: string; status: string }> = [];
  const epicDateChanges: Array<{ id: string; start: string | null; end: string | null }> = [];
  for (const epic of epicRows) {
    const derived = derivedParentStatus(sourcesByEpic.get(epic.id) ?? []);
    const next = derived ?? epic.status;
    epics.set(epic.id, next);
    if (derived != null && derived !== epic.status) {
      epicChanges.push({ id: epic.id, status: derived });
    }
    const span = derivedParentDates(
      { start: epic.startDate, end: epic.endDate },
      datesByEpic.get(epic.id) ?? [],
    );
    rememberDates(
      dates.epics,
      dateChanges,
      'epic',
      epic.id,
      { start: epic.startDate, end: epic.endDate },
      span,
    );
    if (span.start !== epic.startDate || span.end !== epic.endDate) {
      epicDateChanges.push({ id: epic.id, start: span.start, end: span.end });
    }
  }
  await writeStatus(database, projectEpics, epicChanges);
  await writeEpicDates(database, epicDateChanges);

  const milestoneIds = await milestoneIdsForDeliveryEntities(database, projectId, {
    storyIds: [...storyIdSet],
    epicIds: [...epicIdSet],
    taskIds,
    milestoneIds: milestoneIdInput,
  });
  if (milestoneIds.length === 0) return result;

  await recomputeMilestones(database, projectId, milestoneIds, result);
  return result;
}

async function recomputeMilestones(
  database: Database,
  projectId: string,
  milestoneIds: string[],
  into: RecomputedParentStatuses,
): Promise<void> {
  const milestoneRows = await database.db
    .select({
      id: projectMilestones.id,
      status: projectMilestones.status,
      startDate: projectMilestones.startDate,
      targetDate: projectMilestones.targetDate,
    })
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
          .select({
            id: projectEpics.id,
            status: projectEpics.status,
            startDate: projectEpics.startDate,
            endDate: projectEpics.endDate,
          })
          .from(projectEpics)
          .where(and(eq(projectEpics.projectId, projectId), inArray(projectEpics.id, epicIds))),
    storyIds.length === 0
      ? Promise.resolve([])
      : database.db
          .select({
            id: projectUserStories.id,
            status: projectUserStories.status,
            startDate: projectUserStories.startDate,
            endDate: projectUserStories.endDate,
          })
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
            startDate: projectTasks.startDate,
            dueDate: projectTasks.dueDate,
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
    into.milestones.set(milestone.id, next);
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

/** Parents whose dates are the child envelope. Scheduling must not move them. */
export async function rollupLockedParentKeys(
  database: Database,
  projectId: string,
): Promise<Set<string>> {
  const keys = new Set<string>();
  const [stories, epics] = await Promise.all([
    database.db
      .select({ id: projectTasks.userStoryId })
      .from(projectTasks)
      .where(
        and(
          eq(projectTasks.projectId, projectId),
          isNull(projectTasks.archivedAt),
          isNotNull(projectTasks.userStoryId),
          ne(projectTasks.status, 'cancelled'),
          or(isNotNull(projectTasks.startDate), isNotNull(projectTasks.dueDate)),
        ),
      ),
    database.db
      .select({ id: projectUserStories.epicId })
      .from(projectUserStories)
      .where(
        and(
          eq(projectUserStories.projectId, projectId),
          isNull(projectUserStories.archivedAt),
          ne(projectUserStories.status, 'cancelled'),
          or(
            isNotNull(projectUserStories.startDate),
            isNotNull(projectUserStories.endDate),
          ),
        ),
      ),
  ]);
  for (const row of stories) {
    if (row.id) keys.add(deliveryItemKey('user_story', row.id));
  }
  for (const row of epics) keys.add(deliveryItemKey('epic', row.id));
  return keys;
}
