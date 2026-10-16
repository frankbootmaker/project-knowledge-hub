import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import {
  deleteDeliveryDependenciesFor,
  overlaySchedule,
  rescheduleDeliveryFrom,
} from './delivery-dependencies.js';
import type { Database } from '@project-knowledge-hub/database';
import {
  memberships,
  projectEpics,
  projectTaskActivities,
  projectTasks,
  projectUserStories,
  users,
} from '@project-knowledge-hub/database';
import {
  AppError,
  assertDateRange,
  deliveryCompletionIndex,
  derivedDateWriteField,
  displayedParentCompletion,
  effectiveDateRange,
  epicStatusSchema,
  parentDateDetail,
  plannedTargetPercent,
  taskActivityTypeSchema,
  userStoryStatusSchema,
  type DeliveryCompletionRollup,
  type EpicStatus,
  type ParentDateDetail,
  type ParentDateSource,
  type TaskActivityType,
  type UserStoryStatus,
} from '@project-knowledge-hub/domain';
import { deleteMilestoneItemLinks } from './milestone-item-links.js';
import {
  milestoneIdsForDeliveryEntities,
  recomputeDeliveryParentStatuses,
} from './parent-status.js';
import type { PublicItemMediaLink } from './project-item-media.js';
import { withMediaLinkCounts, withMediaLinks } from './project-item-media.js';
import {
  getTask,
  recordTaskActivity,
  type PublicTask,
} from './project-delivery.js';
import { activeMemberConditions } from './user-category.js';
import {
  allocateIssueNumber,
  getProjectKeyPrefix,
  toHumanKeyFields,
} from './project-issue-keys.js';

export type PublicEpic = {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  status: EpicStatus;
  startDate: string | null;
  endDate: string | null;
  sortOrder: number;
  issueKeyType: string | null;
  issueNumber: number | null;
  humanKey: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /**
   * Displayed percent. Done is 100, cancelled is 0, otherwise the average of
   * non-cancelled child tasks and bugs. Null when an open epic has none left.
   */
  completionPercent: number | null;
  /**
   * Planned percent from start through end. 0 on the start day, 100 on the
   * end day. Null when the window is missing. Read-only.
   */
  targetPercent: number | null;
  /** True when startDate is the earliest included child start. Read-only. */
  startDateDerived: boolean;
  /** True when endDate is the latest included child end. Read-only. */
  endDateDerived: boolean;
  mediaLinkCount?: number;
  mediaLinks?: PublicItemMediaLink[];
};

export type PublicUserStory = {
  id: string;
  projectId: string;
  epicId: string;
  title: string;
  description: string | null;
  status: UserStoryStatus;
  startDate: string | null;
  endDate: string | null;
  sortOrder: number;
  issueKeyType: string | null;
  issueNumber: number | null;
  humanKey: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /**
   * Displayed percent. Done is 100, cancelled is 0, otherwise the average of
   * non-cancelled child tasks and bugs. Null when an open story has none left.
   */
  completionPercent: number | null;
  /**
   * Planned percent from start through end. 0 on the start day, 100 on the
   * end day. Null when the window is missing. Read-only.
   */
  targetPercent: number | null;
  /** True when startDate is the earliest included child start. Read-only. */
  startDateDerived: boolean;
  /** True when endDate is the latest included child end. Read-only. */
  endDateDerived: boolean;
  mediaLinkCount?: number;
  mediaLinks?: PublicItemMediaLink[];
};

export type PublicTaskActivity = {
  id: string;
  taskId: string;
  actorUserId: string | null;
  actorDisplayName: string | null;
  actorEmail: string | null;
  actorUserType: string | null;
  type: TaskActivityType;
  body: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
};

function parentCompletionPercent(
  status: string,
  rollup: DeliveryCompletionRollup | undefined,
): number | null {
  return displayedParentCompletion(status, rollup ?? null)?.percent ?? null;
}

async function completionMaps(database: Database, projectId: string) {
  const rows = await database.db
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
    );
  return deliveryCompletionIndex(rows);
}

function toPublicEpic(
  row: typeof projectEpics.$inferSelect,
  keyPrefix: string | null | undefined,
  completionPercent: number | null,
): PublicEpic {
  const keys = toHumanKeyFields(keyPrefix, row.issueKeyType, row.issueNumber);
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    description: row.description,
    status: epicStatusSchema.parse(row.status),
    startDate: row.startDate,
    endDate: row.endDate,
    sortOrder: row.sortOrder,
    issueKeyType: keys.issueKeyType,
    issueNumber: keys.issueNumber,
    humanKey: keys.humanKey,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    completionPercent,
    targetPercent: null,
    startDateDerived: false,
    endDateDerived: false,
  };
}

function toPublicUserStory(
  row: typeof projectUserStories.$inferSelect,
  keyPrefix: string | null | undefined,
  completionPercent: number | null,
): PublicUserStory {
  const keys = toHumanKeyFields(keyPrefix, row.issueKeyType, row.issueNumber);
  return {
    id: row.id,
    projectId: row.projectId,
    epicId: row.epicId,
    title: row.title,
    description: row.description,
    status: userStoryStatusSchema.parse(row.status),
    startDate: row.startDate,
    endDate: row.endDate,
    sortOrder: row.sortOrder,
    issueKeyType: keys.issueKeyType,
    issueNumber: keys.issueNumber,
    humanKey: keys.humanKey,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    completionPercent,
    targetPercent: null,
    startDateDerived: false,
    endDateDerived: false,
  };
}

function scheduleToday(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

type ParentSchedule = {
  storyDetails: Map<string, ParentDateDetail>;
  epicChildren: Map<string, ParentDateSource[]>;
};

async function loadParentSchedule(
  database: Database,
  projectId: string,
): Promise<ParentSchedule> {
  const [taskRows, storyRows] = await Promise.all([
    database.db
      .select({
        status: projectTasks.status,
        startDate: projectTasks.startDate,
        dueDate: projectTasks.dueDate,
        userStoryId: projectTasks.userStoryId,
      })
      .from(projectTasks)
      .where(
        and(eq(projectTasks.projectId, projectId), isNull(projectTasks.archivedAt)),
      ),
    database.db
      .select({
        id: projectUserStories.id,
        epicId: projectUserStories.epicId,
        status: projectUserStories.status,
        startDate: projectUserStories.startDate,
        endDate: projectUserStories.endDate,
        archivedAt: projectUserStories.archivedAt,
      })
      .from(projectUserStories)
      .where(eq(projectUserStories.projectId, projectId)),
  ]);
  const tasksByStory = new Map<string, ParentDateSource[]>();
  for (const task of taskRows) {
    if (!task.userStoryId) continue;
    const list = tasksByStory.get(task.userStoryId) ?? [];
    list.push({ status: task.status, start: task.startDate, end: task.dueDate });
    tasksByStory.set(task.userStoryId, list);
  }
  const storyDetails = new Map<string, ParentDateDetail>();
  const epicChildren = new Map<string, ParentDateSource[]>();
  for (const story of storyRows) {
    const detail = parentDateDetail(
      { start: story.startDate, end: story.endDate },
      tasksByStory.get(story.id) ?? [],
    );
    storyDetails.set(story.id, detail);
    if (story.archivedAt) continue;
    const list = epicChildren.get(story.epicId) ?? [];
    list.push({ status: story.status, start: detail.start, end: detail.end });
    epicChildren.set(story.epicId, list);
  }
  return { storyDetails, epicChildren };
}

function applyParentSchedule<T extends {
  startDate: string | null;
  endDate: string | null;
}>(
  item: T,
  detail: ParentDateDetail,
  today: string,
): T {
  const startDate = detail.startDerived ? detail.start : item.startDate;
  const endDate = detail.endDerived ? detail.end : item.endDate;
  return {
    ...item,
    startDate,
    endDate,
    startDateDerived: detail.startDerived,
    endDateDerived: detail.endDerived,
    targetPercent: plannedTargetPercent(startDate, endDate, today),
  };
}

function assertParentDatesWritable(
  detail: ParentDateDetail,
  input: { startDate?: string | null; endDate?: string | null },
): void {
  const field = derivedDateWriteField({
    detail,
    startDate: input.startDate,
    endDate: input.endDate,
  });
  if (!field) return;
  throw new AppError({
    code: 'DATE_DERIVED',
    message: `${field} is derived from included children and is read-only`,
    statusCode: 400,
  });
}

async function presentEpics(
  database: Database,
  projectId: string,
  epics: PublicEpic[],
): Promise<PublicEpic[]> {
  if (epics.length === 0) return [];
  const schedule = await loadParentSchedule(database, projectId);
  const today = scheduleToday();
  return epics.map((epic) =>
    applyParentSchedule(
      epic,
      parentDateDetail(
        { start: epic.startDate, end: epic.endDate },
        schedule.epicChildren.get(epic.id) ?? [],
      ),
      today,
    ),
  );
}

async function presentStories(
  database: Database,
  projectId: string,
  stories: PublicUserStory[],
): Promise<PublicUserStory[]> {
  if (stories.length === 0) return [];
  const schedule = await loadParentSchedule(database, projectId);
  const today = scheduleToday();
  return stories.map((story) =>
    applyParentSchedule(
      story,
      schedule.storyDetails.get(story.id) ??
        parentDateDetail({ start: story.startDate, end: story.endDate }, []),
      today,
    ),
  );
}

async function assertWorkspaceMembers(
  database: Database,
  workspaceId: string,
  userIds: string[],
): Promise<void> {
  if (userIds.length === 0) return;
  const unique = [...new Set(userIds)];
  const rows = await database.db
    .select({ userId: memberships.userId })
    .from(memberships)
    .innerJoin(users, eq(memberships.userId, users.id))
    .where(
      and(
        eq(memberships.workspaceId, workspaceId),
        inArray(memberships.userId, unique),
        ...activeMemberConditions(),
      ),
    );
  if (rows.length !== unique.length) {
    throw new AppError({
      code: 'OWNER_USER_NOT_MEMBER',
      message: 'User must be an active member of the project workspace',
      statusCode: 400,
    });
  }
}

export async function listEpics(
  database: Database,
  projectId: string,
  options?: { includeArchived?: boolean },
): Promise<PublicEpic[]> {
  const conditions = [eq(projectEpics.projectId, projectId)];
  if (!options?.includeArchived) {
    conditions.push(isNull(projectEpics.archivedAt));
  }
  const rows = await database.db
    .select()
    .from(projectEpics)
    .where(and(...conditions))
    .orderBy(asc(projectEpics.sortOrder), asc(projectEpics.title));
  const keyPrefix = await getProjectKeyPrefix(database, projectId);
  const maps = await completionMaps(database, projectId);
  const epics = await withMediaLinkCounts(
    database,
    'epic',
    rows.map((row) =>
      toPublicEpic(
        row,
        keyPrefix,
        parentCompletionPercent(row.status, maps.byEpicId.get(row.id)),
      ),
    ),
  );
  return presentEpics(database, projectId, epics);
}

export async function getEpic(
  database: Database,
  epicId: string,
): Promise<PublicEpic> {
  const [row] = await database.db
    .select()
    .from(projectEpics)
    .where(eq(projectEpics.id, epicId))
    .limit(1);
  if (!row) {
    throw new AppError({
      code: 'EPIC_NOT_FOUND',
      message: 'Epic not found',
      statusCode: 404,
    });
  }
  const keyPrefix = await getProjectKeyPrefix(database, row.projectId);
  const maps = await completionMaps(database, row.projectId);
  const epic = await withMediaLinks(
    database,
    'epic',
    toPublicEpic(
      row,
      keyPrefix,
      parentCompletionPercent(row.status, maps.byEpicId.get(row.id)),
    ),
  );
  const [presented] = await presentEpics(database, row.projectId, [epic]);
  return presented ?? epic;
}

export async function createEpic(
  database: Database,
  input: {
    projectId: string;
    title: string;
    description?: string | null;
    status?: EpicStatus;
    startDate?: string | null;
    endDate?: string | null;
    sortOrder?: number;
    createdBy?: string | null;
  },
): Promise<PublicEpic> {
  assertDateRange({ start: input.startDate, end: input.endDate, startField: 'startDate', endField: 'endDate' });
  const result = await database.db.transaction(async (tx) => {
    const allocated = await allocateIssueNumber(database, input.projectId, 'E', tx);
    const [row] = await tx
      .insert(projectEpics)
      .values({
        projectId: input.projectId,
        title: input.title,
        description: input.description ?? null,
        status: input.status ?? 'planned',
        startDate: input.startDate ?? null,
        endDate: input.endDate ?? null,
        sortOrder: input.sortOrder ?? 0,
        issueKeyType: allocated.issueKeyType,
        issueNumber: allocated.issueNumber,
        createdBy: input.createdBy ?? null,
      })
      .returning();
    if (!row) {
      throw new AppError({
        code: 'EPIC_CREATE_FAILED',
        message: 'Failed to create epic',
        statusCode: 500,
      });
    }
    return { row, keyPrefix: allocated.keyPrefix };
  });
  const maps = await completionMaps(database, result.row.projectId);
  const epic = await withMediaLinks(
    database,
    'epic',
    toPublicEpic(
      result.row,
      result.keyPrefix,
      parentCompletionPercent(result.row.status, maps.byEpicId.get(result.row.id)),
    ),
  );
  const [presented] = await presentEpics(database, result.row.projectId, [epic]);
  return presented ?? epic;
}

export async function updateEpic(
  database: Database,
  epicId: string,
  input: {
    title?: string;
    description?: string | null;
    status?: EpicStatus;
    startDate?: string | null;
    endDate?: string | null;
    sortOrder?: number;
    archived?: boolean;
  },
): Promise<PublicEpic> {
  const [existing] = await database.db
    .select()
    .from(projectEpics)
    .where(eq(projectEpics.id, epicId))
    .limit(1);
  if (!existing) {
    throw new AppError({
      code: 'EPIC_NOT_FOUND',
      message: 'Epic not found',
      statusCode: 404,
    });
  }

  const schedule = await loadParentSchedule(database, existing.projectId);
  assertParentDatesWritable(
    parentDateDetail(
      { start: existing.startDate, end: existing.endDate },
      schedule.epicChildren.get(existing.id) ?? [],
    ),
    input,
  );

  const effectiveDates = effectiveDateRange({
    stored: { start: existing.startDate, end: existing.endDate },
    patch: { start: input.startDate, end: input.endDate },
  });
  assertDateRange({ start: effectiveDates.start, end: effectiveDates.end, startField: 'startDate', endField: 'endDate' });

  const [row] = await database.db
    .update(projectEpics)
    .set({
      title: input.title ?? existing.title,
      description:
        input.description !== undefined ? input.description : existing.description,
      status: input.status ?? existing.status,
      startDate: input.startDate !== undefined ? input.startDate : existing.startDate,
      endDate: input.endDate !== undefined ? input.endDate : existing.endDate,
      sortOrder: input.sortOrder ?? existing.sortOrder,
      archivedAt:
        input.archived === undefined
          ? existing.archivedAt
          : input.archived
            ? existing.archivedAt ?? new Date()
            : null,
      updatedAt: new Date(),
    })
    .where(eq(projectEpics.id, epicId))
    .returning();
  if (!row) {
    throw new AppError({
      code: 'EPIC_NOT_FOUND',
      message: 'Epic not found',
      statusCode: 404,
    });
  }
  const applied = await recomputeDeliveryParentStatuses(database, row.projectId, {
    epicIds: [row.id],
  });
  const status = applied.epics.get(row.id) ?? row.status;
  const span = applied.dates.epics.get(row.id);
  const stored = {
    ...row,
    status,
    startDate: span?.start ?? row.startDate,
    endDate: span?.end ?? row.endDate,
  };
  const keyPrefix = await getProjectKeyPrefix(database, row.projectId);
  const maps = await completionMaps(database, row.projectId);
  const writes = await rescheduleDeliveryFrom(database, row.projectId, [
    { entityType: 'epic', id: row.id },
    ...applied.dateChanges,
  ]);
  const epic = await withMediaLinks(
    database,
    'epic',
    overlaySchedule(
      toPublicEpic(
        stored,
        keyPrefix,
        parentCompletionPercent(stored.status, maps.byEpicId.get(row.id)),
      ),
      'epic',
      writes,
      'endDate',
    ),
  );
  const [presented] = await presentEpics(database, row.projectId, [epic]);
  return presented ?? epic;
}

export async function listUserStories(
  database: Database,
  projectId: string,
  options?: { epicId?: string; includeArchived?: boolean },
): Promise<PublicUserStory[]> {
  const conditions = [eq(projectUserStories.projectId, projectId)];
  if (!options?.includeArchived) {
    conditions.push(isNull(projectUserStories.archivedAt));
  }
  if (options?.epicId) {
    conditions.push(eq(projectUserStories.epicId, options.epicId));
  }
  const rows = await database.db
    .select()
    .from(projectUserStories)
    .where(and(...conditions))
    .orderBy(asc(projectUserStories.sortOrder), asc(projectUserStories.title));
  const keyPrefix = await getProjectKeyPrefix(database, projectId);
  const maps = await completionMaps(database, projectId);
  const stories = await withMediaLinkCounts(
    database,
    'user_story',
    rows.map((row) =>
      toPublicUserStory(
        row,
        keyPrefix,
        parentCompletionPercent(row.status, maps.byStoryId.get(row.id)),
      ),
    ),
  );
  return presentStories(database, projectId, stories);
}

export async function getUserStory(
  database: Database,
  storyId: string,
): Promise<PublicUserStory> {
  const [row] = await database.db
    .select()
    .from(projectUserStories)
    .where(eq(projectUserStories.id, storyId))
    .limit(1);
  if (!row) {
    throw new AppError({
      code: 'USER_STORY_NOT_FOUND',
      message: 'User story not found',
      statusCode: 404,
    });
  }
  const keyPrefix = await getProjectKeyPrefix(database, row.projectId);
  const maps = await completionMaps(database, row.projectId);
  const story = await withMediaLinks(
    database,
    'user_story',
    toPublicUserStory(
      row,
      keyPrefix,
      parentCompletionPercent(row.status, maps.byStoryId.get(row.id)),
    ),
  );
  const [presented] = await presentStories(database, row.projectId, [story]);
  return presented ?? story;
}

async function assertEpicInProject(
  database: Database,
  projectId: string,
  epicId: string,
): Promise<void> {
  const [epic] = await database.db
    .select({ id: projectEpics.id })
    .from(projectEpics)
    .where(
      and(eq(projectEpics.id, epicId), eq(projectEpics.projectId, projectId)),
    )
    .limit(1);
  if (!epic) {
    throw new AppError({
      code: 'EPIC_NOT_FOUND',
      message: 'Epic not found in this project',
      statusCode: 400,
    });
  }
}

export async function createUserStory(
  database: Database,
  input: {
    projectId: string;
    epicId: string;
    title: string;
    description?: string | null;
    status?: UserStoryStatus;
    startDate?: string | null;
    endDate?: string | null;
    sortOrder?: number;
    createdBy?: string | null;
  },
): Promise<PublicUserStory> {
  assertDateRange({ start: input.startDate, end: input.endDate, startField: 'startDate', endField: 'endDate' });
  await assertEpicInProject(database, input.projectId, input.epicId);
  const result = await database.db.transaction(async (tx) => {
    const allocated = await allocateIssueNumber(database, input.projectId, 'S', tx);
    const [row] = await tx
      .insert(projectUserStories)
      .values({
        projectId: input.projectId,
        epicId: input.epicId,
        title: input.title,
        description: input.description ?? null,
        status: input.status ?? 'planned',
        startDate: input.startDate ?? null,
        endDate: input.endDate ?? null,
        sortOrder: input.sortOrder ?? 0,
        issueKeyType: allocated.issueKeyType,
        issueNumber: allocated.issueNumber,
        createdBy: input.createdBy ?? null,
      })
      .returning();
    if (!row) {
      throw new AppError({
        code: 'USER_STORY_CREATE_FAILED',
        message: 'Failed to create user story',
        statusCode: 500,
      });
    }
    return { row, keyPrefix: allocated.keyPrefix };
  });
  const maps = await completionMaps(database, result.row.projectId);
  const story = await withMediaLinks(
    database,
    'user_story',
    toPublicUserStory(
      result.row,
      result.keyPrefix,
      parentCompletionPercent(result.row.status, maps.byStoryId.get(result.row.id)),
    ),
  );
  const [presented] = await presentStories(database, result.row.projectId, [story]);
  return presented ?? story;
}

export async function updateUserStory(
  database: Database,
  storyId: string,
  input: {
    title?: string;
    description?: string | null;
    status?: UserStoryStatus;
    epicId?: string;
    startDate?: string | null;
    endDate?: string | null;
    sortOrder?: number;
    archived?: boolean;
  },
): Promise<PublicUserStory> {
  const [existing] = await database.db
    .select()
    .from(projectUserStories)
    .where(eq(projectUserStories.id, storyId))
    .limit(1);
  if (!existing) {
    throw new AppError({
      code: 'USER_STORY_NOT_FOUND',
      message: 'User story not found',
      statusCode: 404,
    });
  }
  if (input.epicId !== undefined) {
    await assertEpicInProject(database, existing.projectId, input.epicId);
  }

  const schedule = await loadParentSchedule(database, existing.projectId);
  assertParentDatesWritable(
    schedule.storyDetails.get(existing.id) ??
      parentDateDetail({ start: existing.startDate, end: existing.endDate }, []),
    input,
  );

  const effectiveDates = effectiveDateRange({
    stored: { start: existing.startDate, end: existing.endDate },
    patch: { start: input.startDate, end: input.endDate },
  });
  assertDateRange({ start: effectiveDates.start, end: effectiveDates.end, startField: 'startDate', endField: 'endDate' });

  const [row] = await database.db
    .update(projectUserStories)
    .set({
      title: input.title ?? existing.title,
      description:
        input.description !== undefined ? input.description : existing.description,
      status: input.status ?? existing.status,
      epicId: input.epicId ?? existing.epicId,
      startDate: input.startDate !== undefined ? input.startDate : existing.startDate,
      endDate: input.endDate !== undefined ? input.endDate : existing.endDate,
      sortOrder: input.sortOrder ?? existing.sortOrder,
      archivedAt:
        input.archived === undefined
          ? existing.archivedAt
          : input.archived
            ? existing.archivedAt ?? new Date()
            : null,
      updatedAt: new Date(),
    })
    .where(eq(projectUserStories.id, storyId))
    .returning();
  if (!row) {
    throw new AppError({
      code: 'USER_STORY_NOT_FOUND',
      message: 'User story not found',
      statusCode: 404,
    });
  }
  const applied = await recomputeDeliveryParentStatuses(database, row.projectId, {
    storyIds: [row.id],
    epicIds: [existing.epicId, row.epicId],
  });
  const status = applied.stories.get(row.id) ?? row.status;
  const span = applied.dates.stories.get(row.id);
  const stored = {
    ...row,
    status,
    startDate: span?.start ?? row.startDate,
    endDate: span?.end ?? row.endDate,
  };
  const keyPrefix = await getProjectKeyPrefix(database, row.projectId);
  const maps = await completionMaps(database, row.projectId);
  const writes = await rescheduleDeliveryFrom(database, row.projectId, [
    { entityType: 'user_story', id: row.id },
    ...applied.dateChanges,
  ]);
  const story = await withMediaLinks(
    database,
    'user_story',
    overlaySchedule(
      toPublicUserStory(
        stored,
        keyPrefix,
        parentCompletionPercent(stored.status, maps.byStoryId.get(row.id)),
      ),
      'user_story',
      writes,
      'endDate',
    ),
  );
  const [presented] = await presentStories(database, row.projectId, [story]);
  return presented ?? story;
}

export async function deleteEpic(
  database: Database,
  epicId: string,
): Promise<{ id: string; projectId: string }> {
  const existing = await getEpic(database, epicId);
  const stories = await database.db
    .select({ id: projectUserStories.id })
    .from(projectUserStories)
    .where(eq(projectUserStories.epicId, epicId));
  const storyIds = stories.map((row) => row.id);
  const milestoneIds = await milestoneIdsForDeliveryEntities(database, existing.projectId, {
    epicIds: [epicId],
    storyIds,
  });
  await deleteDeliveryDependenciesFor(database, 'epic', [epicId]);
  await deleteMilestoneItemLinks(database, 'epic', [epicId]);
  await deleteDeliveryDependenciesFor(database, 'user_story', storyIds);
  await deleteMilestoneItemLinks(database, 'user_story', storyIds);
  await database.db.delete(projectEpics).where(eq(projectEpics.id, epicId));
  await recomputeDeliveryParentStatuses(database, existing.projectId, { milestoneIds });
  if (milestoneIds.length > 0) {
    await rescheduleDeliveryFrom(
      database,
      existing.projectId,
      milestoneIds.map((id) => ({ entityType: 'milestone' as const, id })),
    );
  }
  return { id: existing.id, projectId: existing.projectId };
}

export async function deleteUserStory(
  database: Database,
  storyId: string,
): Promise<{ id: string; projectId: string }> {
  const existing = await getUserStory(database, storyId);
  const milestoneIds = await milestoneIdsForDeliveryEntities(database, existing.projectId, {
    storyIds: [storyId],
    epicIds: [existing.epicId],
  });
  await deleteDeliveryDependenciesFor(database, 'user_story', [storyId]);
  await deleteMilestoneItemLinks(database, 'user_story', [storyId]);
  await database.db
    .delete(projectUserStories)
    .where(eq(projectUserStories.id, storyId));
  await recomputeDeliveryParentStatuses(database, existing.projectId, {
    epicIds: [existing.epicId],
    milestoneIds,
  });
  await rescheduleDeliveryFrom(database, existing.projectId, [
    { entityType: 'epic', id: existing.epicId },
    ...milestoneIds.map((id) => ({ entityType: 'milestone' as const, id })),
  ]);
  return { id: existing.id, projectId: existing.projectId };
}

export async function listTaskActivities(
  database: Database,
  taskId: string,
): Promise<PublicTaskActivity[]> {
  const rows = await database.db
    .select({
      id: projectTaskActivities.id,
      taskId: projectTaskActivities.taskId,
      actorUserId: projectTaskActivities.actorUserId,
      type: projectTaskActivities.type,
      body: projectTaskActivities.body,
      metadataJson: projectTaskActivities.metadataJson,
      createdAt: projectTaskActivities.createdAt,
      actorDisplayName: users.displayName,
      actorEmail: users.email,
      actorUserType: users.userType,
    })
    .from(projectTaskActivities)
    .leftJoin(users, eq(projectTaskActivities.actorUserId, users.id))
    .where(eq(projectTaskActivities.taskId, taskId))
    .orderBy(desc(projectTaskActivities.createdAt));

  return rows.map((row) => ({
    id: row.id,
    taskId: row.taskId,
    actorUserId: row.actorUserId,
    actorDisplayName: row.actorDisplayName,
    actorEmail: row.actorEmail,
    actorUserType: row.actorUserType,
    type: taskActivityTypeSchema.parse(row.type),
    body: row.body,
    metadata: row.metadataJson ?? null,
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function addTaskComment(
  database: Database,
  input: {
    taskId: string;
    actorUserId: string;
    body: string;
  },
): Promise<PublicTaskActivity> {
  await getTask(database, input.taskId);
  await recordTaskActivity(database, {
    taskId: input.taskId,
    actorUserId: input.actorUserId,
    type: 'comment',
    body: input.body,
  });
  const [latest] = await listTaskActivities(database, input.taskId);
  if (!latest) {
    throw new AppError({
      code: 'ACTIVITY_CREATE_FAILED',
      message: 'Failed to create comment',
      statusCode: 500,
    });
  }
  return latest;
}

export async function handoffTask(
  database: Database,
  input: {
    taskId: string;
    workspaceId: string;
    actorUserId: string;
    toUserId: string;
    note?: string | null;
  },
): Promise<PublicTask> {
  const existing = await getTask(database, input.taskId);
  await assertWorkspaceMembers(database, input.workspaceId, [input.toUserId]);

  const fromUserId = existing.currentOwner?.userId ?? null;
  await database.db
    .update(projectTasks)
    .set({
      currentOwnerUserId: input.toUserId,
      updatedAt: new Date(),
    })
    .where(eq(projectTasks.id, input.taskId));

  await recordTaskActivity(database, {
    taskId: input.taskId,
    actorUserId: input.actorUserId,
    type: 'handoff',
    body: input.note ?? null,
    metadata: {
      fromUserId,
      toUserId: input.toUserId,
    },
  });

  return getTask(database, input.taskId);
}
