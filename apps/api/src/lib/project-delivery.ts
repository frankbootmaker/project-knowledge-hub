import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { Database } from '@project-knowledge-hub/database';
import {
  memberships,
  projectEpics,
  projectMilestones,
  projectSprints,
  projectTaskActivities,
  projectTaskRaci,
  projectTasks,
  projectUserStories,
  projects,
  systems,
  users,
  workspaces,
} from '@project-knowledge-hub/database';
import {
  deleteDeliveryDependenciesFor,
  overlaySchedule,
  rescheduleDeliveryFrom,
} from './delivery-dependencies.js';
import { loadProjectCalendar } from './project-calendar.js';
import type { PublicItemMediaLink } from './project-item-media.js';
import {
  withMediaLinkCounts,
  withMediaLinks,
} from './project-item-media.js';
import {
  AppError,
  bugFoundInSchema,
  bugResolutionSchema,
  resolveTaskScheduleDates,
  mergeAiUsage,
  milestoneStatusSchema,
  raciRoleSchema,
  raidSeveritySchema,
  resolveBugCreate,
  displayedTaskCompletionPercent,
  resolveTaskCompletionPercent,
  statusForTaskCompletionChange,
  resolveBugUpdate,
  taskActivityTypeSchema,
  taskItemTypeSchema,
  taskStatusSchema,
  type AiUsageCounts,
  type AiUsagePatch,
  type BugFieldPatch,
  type BugFoundIn,
  type BugResolution,
  type BugWriteResult,
  type MilestoneStatus,
  type RaciRole,
  type RaidSeverity,
  type StoredBugFields,
  type TaskActivityType,
  type TaskItemType,
  type TaskStatus,
} from '@project-knowledge-hub/domain';
import {
  allocateIssueNumber,
  getProjectKeyPrefix,
  toHumanKeyFields,
} from './project-issue-keys.js';
import { withMilestoneLinks, deleteMilestoneItemLinks } from './milestone-item-links.js';
import {
  milestoneIdsForDeliveryEntities,
  recomputeDeliveryParentStatuses,
} from './parent-status.js';
import { avatarUrlForUser } from './public-user.js';
import { assertAiAssistantForProject } from './ai-assistant-systems.js';
import { diffReplacement } from './replace-diff.js';
import { activeMemberConditions } from './user-category.js';

export type PublicRaciEntry = {
  userId: string;
  displayName: string;
  email: string;
  userType: string;
  role: RaciRole;
  avatarUrl: string | null;
};

export type PublicTaskOwner = {
  userId: string;
  displayName: string;
  email: string;
  userType: string;
  avatarUrl: string | null;
};

export type PublicMilestone = {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  status: MilestoneStatus;
  startDate: string | null;
  targetDate: string | null;
  sortOrder: number;
  issueKeyType: string | null;
  issueNumber: number | null;
  humanKey: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Derived from linked items. 100 when every included link is complete. */
  completionPercent: number | null;
  completion: { percent: number; done: number; total: number } | null;
  linkedItems: Array<{
    entityType: 'epic' | 'user_story' | 'task';
    entityId: string;
    itemType: 'task' | 'bug' | null;
    title: string;
    humanKey: string | null;
    status: string;
    completionPercent: number | null;
  }>;
  mediaLinkCount?: number;
  mediaLinks?: PublicItemMediaLink[];
};

export type PublicTask = {
  id: string;
  projectId: string;
  milestoneId: string | null;
  userStoryId: string | null;
  sprintId: string | null;
  title: string;
  description: string | null;
  itemType: TaskItemType;
  severity: RaidSeverity | null;
  foundIn: BugFoundIn | null;
  foundInNote: string | null;
  stepsToReproduce: string | null;
  expectedBehavior: string | null;
  actualBehavior: string | null;
  resolution: BugResolution | null;
  regression: boolean;
  affectedSystemId: string | null;
  duplicateOfTaskId: string | null;
  status: TaskStatus;
  startDate: string | null;
  dueDate: string | null;
  durationDays: number | null;
  forecastHours: number | null;
  actualHours: number | null;
  storyPoints: number | null;
  completionPercent: number | null;
  tokensUsed: number | null;
  tokensInput: number | null;
  tokensOutput: number | null;
  tokensCache: number | null;
  modelId: string | null;
  pricingTier: string | null;
  usageOccurredAt: string | null;
  billingPeriod: string | null;
  aiSystemId: string | null;
  sortOrder: number;
  createdBy: string | null;
  currentOwnerUserId: string | null;
  currentOwner: PublicTaskOwner | null;
  userStoryTitle: string | null;
  epicId: string | null;
  epicTitle: string | null;
  issueKeyType: string | null;
  issueNumber: number | null;
  humanKey: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /**
   * Latest `status_changed` activity whose metadata `to` is `done`.
   * Derived, read-only, and independent of `updatedAt`.
   */
  completedAt: string | null;
  raci: PublicRaciEntry[];
  mediaLinkCount?: number;
  mediaLinks?: PublicItemMediaLink[];
};

/** Task the current user holds a RACI role on, with project/workspace context. */
export type PublicAssignedTask = PublicTask & {
  myRole: RaciRole;
  projectName: string;
  projectSlug: string;
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
  milestoneTitle: string | null;
};

export type ProjectContext = {
  project: typeof projects.$inferSelect;
};

function toPublicMilestone(
  row: typeof projectMilestones.$inferSelect,
  keyPrefix?: string | null,
): PublicMilestone {
  const keys = toHumanKeyFields(keyPrefix, row.issueKeyType, row.issueNumber);
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    description: row.description,
    status: milestoneStatusSchema.parse(row.status),
    startDate: row.startDate,
    targetDate: row.targetDate,
    sortOrder: row.sortOrder,
    issueKeyType: keys.issueKeyType,
    issueNumber: keys.issueNumber,
    humanKey: keys.humanKey,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    completionPercent: null,
    completion: null,
    linkedItems: [],
  };
}

function toPublicTask(
  row: typeof projectTasks.$inferSelect,
  raci: PublicRaciEntry[],
  extras?: {
    currentOwner?: PublicTaskOwner | null;
    userStoryTitle?: string | null;
    epicId?: string | null;
    epicTitle?: string | null;
    keyPrefix?: string | null;
    completedAt?: string | null;
  },
): PublicTask {
  const keys = toHumanKeyFields(
    extras?.keyPrefix,
    row.issueKeyType,
    row.issueNumber,
  );
  return {
    id: row.id,
    projectId: row.projectId,
    milestoneId: row.milestoneId,
    userStoryId: row.userStoryId,
    sprintId: row.sprintId,
    title: row.title,
    description: row.description,
    itemType: taskItemTypeSchema.parse(row.itemType ?? 'task'),
    severity: row.severity ? raidSeveritySchema.parse(row.severity) : null,
    foundIn: row.foundIn ? bugFoundInSchema.parse(row.foundIn) : null,
    foundInNote: row.foundInNote,
    stepsToReproduce: row.stepsToReproduce,
    expectedBehavior: row.expectedBehavior,
    actualBehavior: row.actualBehavior,
    resolution: row.resolution ? bugResolutionSchema.parse(row.resolution) : null,
    regression: row.regression,
    affectedSystemId: row.affectedSystemId,
    duplicateOfTaskId: row.duplicateOfTaskId,
    status: taskStatusSchema.parse(row.status),
    startDate: row.startDate,
    dueDate: row.dueDate,
    durationDays: row.durationDays ?? null,
    forecastHours: row.forecastHours,
    actualHours: row.actualHours,
    storyPoints: row.storyPoints ?? null,
    completionPercent: displayedTaskCompletionPercent(
      row.status,
      row.completionPercent,
    ),
    tokensUsed: row.tokensUsed ?? null,
    tokensInput: row.tokensInput ?? null,
    tokensOutput: row.tokensOutput ?? null,
    tokensCache: row.tokensCache ?? null,
    modelId: row.aiModelId ?? null,
    pricingTier: row.aiPricingTier ?? null,
    usageOccurredAt: row.usageOccurredAt?.toISOString() ?? null,
    billingPeriod: row.billingPeriod ?? null,
    aiSystemId: row.aiSystemId ?? null,
    sortOrder: row.sortOrder,
    createdBy: row.createdBy,
    currentOwnerUserId: row.currentOwnerUserId,
    currentOwner: extras?.currentOwner ?? null,
    userStoryTitle: extras?.userStoryTitle ?? null,
    epicId: extras?.epicId ?? null,
    epicTitle: extras?.epicTitle ?? null,
    issueKeyType: keys.issueKeyType,
    issueNumber: keys.issueNumber,
    humanKey: keys.humanKey,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    completedAt: extras?.completedAt ?? null,
    raci,
  };
}

/** One query for the latest transition to done. Not per task. */
export async function loadCompletedAtByTask(
  database: Database,
  taskIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (taskIds.length === 0) {
    return map;
  }
  const activities = await database.db
    .select({
      taskId: projectTaskActivities.taskId,
      metadataJson: projectTaskActivities.metadataJson,
      createdAt: projectTaskActivities.createdAt,
    })
    .from(projectTaskActivities)
    .where(
      and(
        inArray(projectTaskActivities.taskId, taskIds),
        eq(projectTaskActivities.type, 'status_changed'),
      ),
    )
    .orderBy(desc(projectTaskActivities.createdAt));

  for (const activity of activities) {
    if (map.has(activity.taskId)) continue;
    const meta = activity.metadataJson;
    const to =
      meta && typeof meta === 'object' && 'to' in meta
        ? String((meta as { to?: unknown }).to)
        : null;
    if (to === 'done') {
      map.set(activity.taskId, activity.createdAt.toISOString());
    }
  }
  return map;
}

async function loadTaskContext(
  database: Database,
  rows: Array<typeof projectTasks.$inferSelect>,
): Promise<{
  owners: Map<string, PublicTaskOwner>;
  stories: Map<string, { title: string; epicId: string; epicTitle: string | null }>;
}> {
  const owners = new Map<string, PublicTaskOwner>();
  const stories = new Map<
    string,
    { title: string; epicId: string; epicTitle: string | null }
  >();
  if (rows.length === 0) {
    return { owners, stories };
  }

  const ownerIds = [
    ...new Set(
      rows
        .map((row) => row.currentOwnerUserId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  if (ownerIds.length > 0) {
    const ownerRows = await database.db
      .select({
        userId: users.id,
        displayName: users.displayName,
        email: users.email,
        userType: users.userType,
        avatarContentType: users.avatarContentType,
        updatedAt: users.updatedAt,
      })
      .from(users)
      .where(inArray(users.id, ownerIds));
    for (const owner of ownerRows) {
      owners.set(owner.userId, {
        userId: owner.userId,
        displayName: owner.displayName,
        email: owner.email,
        userType: owner.userType,
        avatarUrl: avatarUrlForUser(
          owner.userId,
          owner.avatarContentType ?? null,
          owner.updatedAt,
        ),
      });
    }
  }

  const storyIds = [
    ...new Set(
      rows
        .map((row) => row.userStoryId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  if (storyIds.length > 0) {
    const storyRows = await database.db
      .select({
        id: projectUserStories.id,
        title: projectUserStories.title,
        epicId: projectUserStories.epicId,
        epicTitle: projectEpics.title,
      })
      .from(projectUserStories)
      .leftJoin(projectEpics, eq(projectUserStories.epicId, projectEpics.id))
      .where(inArray(projectUserStories.id, storyIds));
    for (const story of storyRows) {
      stories.set(story.id, {
        title: story.title,
        epicId: story.epicId,
        epicTitle: story.epicTitle,
      });
    }
  }

  return { owners, stories };
}

function mapTasksWithContext(
  rows: Array<typeof projectTasks.$inferSelect>,
  raciMap: Map<string, PublicRaciEntry[]>,
  owners: Map<string, PublicTaskOwner>,
  stories: Map<string, { title: string; epicId: string; epicTitle: string | null }>,
  keyPrefixByProject: Map<string, string | null>,
  completedAtByTask: Map<string, string>,
): PublicTask[] {
  return rows.map((row) => {
    const story = row.userStoryId ? stories.get(row.userStoryId) : undefined;
    return toPublicTask(row, raciMap.get(row.id) ?? [], {
      currentOwner: row.currentOwnerUserId
        ? owners.get(row.currentOwnerUserId) ?? null
        : null,
      userStoryTitle: story?.title ?? null,
      epicId: story?.epicId ?? null,
      epicTitle: story?.epicTitle ?? null,
      keyPrefix: keyPrefixByProject.get(row.projectId) ?? null,
      completedAt: completedAtByTask.get(row.id) ?? null,
    });
  });
}

async function withTaskContext(
  database: Database,
  rows: Array<typeof projectTasks.$inferSelect>,
  keyPrefixByProject: Map<string, string | null>,
): Promise<PublicTask[]> {
  const ids = rows.map((row) => row.id);
  const [raciMap, context, completedAtByTask] = await Promise.all([
    loadRaciForTasks(database, ids),
    loadTaskContext(database, rows),
    loadCompletedAtByTask(database, ids),
  ]);
  return mapTasksWithContext(
    rows,
    raciMap,
    context.owners,
    context.stories,
    keyPrefixByProject,
    completedAtByTask,
  );
}

function defaultOwnerFromRaci(
  raci: Array<{ userId: string; role: RaciRole }>,
  createdBy?: string | null,
): string | null {
  return (
    raci.find((entry) => entry.role === 'R')?.userId ??
    raci.find((entry) => entry.role === 'A')?.userId ??
    createdBy ??
    null
  );
}

export async function recordTaskActivity(
  database: Database,
  input: {
    taskId: string;
    actorUserId?: string | null;
    type: TaskActivityType;
    body?: string | null;
    metadata?: Record<string, unknown> | null;
  },
): Promise<void> {
  taskActivityTypeSchema.parse(input.type);
  await database.db.insert(projectTaskActivities).values({
    taskId: input.taskId,
    actorUserId: input.actorUserId ?? null,
    type: input.type,
    body: input.body ?? null,
    metadataJson: input.metadata ?? null,
  });
}

async function assertUserStoryInProject(
  database: Database,
  projectId: string,
  userStoryId: string | null | undefined,
): Promise<void> {
  if (!userStoryId) return;
  const [story] = await database.db
    .select({ id: projectUserStories.id })
    .from(projectUserStories)
    .where(
      and(
        eq(projectUserStories.id, userStoryId),
        eq(projectUserStories.projectId, projectId),
      ),
    )
    .limit(1);
  if (!story) {
    throw new AppError({
      code: 'USER_STORY_NOT_FOUND',
      message: 'User story not found in this project',
      statusCode: 400,
    });
  }
}

export async function requireProjectContext(
  database: Database,
  projectId: string,
): Promise<ProjectContext> {
  const [project] = await database.db
    .select()
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
  return { project };
}

export function assertProjectNotArchived(project: typeof projects.$inferSelect): void {
  if (project.archivedAt) {
    throw new AppError({
      code: 'PROJECT_ARCHIVED',
      message: 'Archived projects are read-only for delivery changes',
      statusCode: 409,
    });
  }
}

async function loadRaciForTasks(
  database: Database,
  taskIds: string[],
): Promise<Map<string, PublicRaciEntry[]>> {
  const map = new Map<string, PublicRaciEntry[]>();
  if (taskIds.length === 0) {
    return map;
  }
  const rows = await database.db
    .select({
      taskId: projectTaskRaci.taskId,
      userId: projectTaskRaci.userId,
      role: projectTaskRaci.role,
      displayName: users.displayName,
      email: users.email,
      userType: users.userType,
      avatarContentType: users.avatarContentType,
      updatedAt: users.updatedAt,
    })
    .from(projectTaskRaci)
    .innerJoin(users, eq(projectTaskRaci.userId, users.id))
    .where(inArray(projectTaskRaci.taskId, taskIds));

  for (const row of rows) {
    const entry: PublicRaciEntry = {
      userId: row.userId,
      displayName: row.displayName,
      email: row.email,
      userType: row.userType,
      role: raciRoleSchema.parse(row.role),
      avatarUrl: avatarUrlForUser(
        row.userId,
        row.avatarContentType ?? null,
        row.updatedAt,
      ),
    };
    const list = map.get(row.taskId) ?? [];
    list.push(entry);
    map.set(row.taskId, list);
  }
  for (const [taskId, list] of map) {
    list.sort((a, b) => a.role.localeCompare(b.role) || a.displayName.localeCompare(b.displayName));
    map.set(taskId, list);
  }
  return map;
}

export async function listMilestones(
  database: Database,
  projectId: string,
  options?: { includeArchived?: boolean },
): Promise<PublicMilestone[]> {
  const rows = await database.db
    .select()
    .from(projectMilestones)
    .where(
      options?.includeArchived
        ? eq(projectMilestones.projectId, projectId)
        : and(
            eq(projectMilestones.projectId, projectId),
            isNull(projectMilestones.archivedAt),
          ),
    )
    .orderBy(asc(projectMilestones.sortOrder), asc(projectMilestones.targetDate));
  const keyPrefix = await getProjectKeyPrefix(database, projectId);
  const publicRows = await withMilestoneLinks(
    database,
    projectId,
    keyPrefix,
    rows.map((row) => toPublicMilestone(row, keyPrefix)),
  );
  return withMediaLinkCounts(database, 'milestone', publicRows);
}

export async function createMilestone(
  database: Database,
  input: {
    projectId: string;
    title: string;
    description?: string | null;
    status?: MilestoneStatus;
    startDate?: string | null;
    targetDate?: string | null;
    sortOrder?: number;
    createdBy?: string | null;
  },
): Promise<PublicMilestone> {
  const result = await database.db.transaction(async (tx) => {
    const allocated = await allocateIssueNumber(database, input.projectId, 'M', tx);
    const [row] = await tx
      .insert(projectMilestones)
      .values({
        projectId: input.projectId,
        title: input.title,
        description: input.description ?? null,
        status: input.status ?? 'planned',
        startDate: input.startDate ?? null,
        targetDate: input.targetDate ?? null,
        sortOrder: input.sortOrder ?? 0,
        issueKeyType: allocated.issueKeyType,
        issueNumber: allocated.issueNumber,
        createdBy: input.createdBy ?? null,
      })
      .returning();
    if (!row) {
      throw new AppError({
        code: 'MILESTONE_CREATE_FAILED',
        message: 'Failed to create milestone',
        statusCode: 500,
      });
    }
    return { row, keyPrefix: allocated.keyPrefix };
  });
  const milestone = toPublicMilestone(result.row, result.keyPrefix);
  const [enriched] = await withMilestoneLinks(
    database,
    milestone.projectId,
    result.keyPrefix,
    [milestone],
  );
  return enriched ?? milestone;
}

export async function updateMilestone(
  database: Database,
  milestoneId: string,
  input: {
    title?: string;
    description?: string | null;
    status?: MilestoneStatus;
    startDate?: string | null;
    targetDate?: string | null;
    sortOrder?: number;
    archived?: boolean;
  },
): Promise<PublicMilestone> {
  const [existing] = await database.db
    .select()
    .from(projectMilestones)
    .where(eq(projectMilestones.id, milestoneId))
    .limit(1);
  if (!existing) {
    throw new AppError({
      code: 'MILESTONE_NOT_FOUND',
      message: 'Milestone not found',
      statusCode: 404,
    });
  }

  const [row] = await database.db
    .update(projectMilestones)
    .set({
      title: input.title ?? existing.title,
      description:
        input.description !== undefined ? input.description : existing.description,
      status: input.status ?? existing.status,
      startDate: input.startDate !== undefined ? input.startDate : existing.startDate,
      targetDate: input.targetDate !== undefined ? input.targetDate : existing.targetDate,
      sortOrder: input.sortOrder ?? existing.sortOrder,
      archivedAt:
        input.archived === undefined
          ? existing.archivedAt
          : input.archived
            ? existing.archivedAt ?? new Date()
            : null,
      updatedAt: new Date(),
    })
    .where(eq(projectMilestones.id, milestoneId))
    .returning();
  if (!row) {
    throw new AppError({
      code: 'MILESTONE_UPDATE_FAILED',
      message: 'Failed to update milestone',
      statusCode: 500,
    });
  }
  const applied = await recomputeDeliveryParentStatuses(database, row.projectId, {
    milestoneIds: [row.id],
  });
  const status = applied.milestones.get(row.id) ?? row.status;
  const span = applied.dates.milestones.get(row.id);
  const stored = {
    ...row,
    status,
    startDate: span?.start ?? row.startDate,
    targetDate: span?.end ?? row.targetDate,
  };
  const keyPrefix = await getProjectKeyPrefix(database, row.projectId);
  const writes = await rescheduleDeliveryFrom(database, row.projectId, [
    { entityType: 'milestone', id: row.id },
    ...applied.dateChanges,
  ]);
  const milestone = overlaySchedule(
    toPublicMilestone(stored, keyPrefix),
    'milestone',
    writes,
    'targetDate',
  );
  const [enriched] = await withMilestoneLinks(
    database,
    milestone.projectId,
    keyPrefix,
    [milestone],
  );
  return enriched ?? milestone;
}

export async function getPublicMilestone(
  database: Database,
  milestoneId: string,
): Promise<PublicMilestone> {
  const row = await getMilestone(database, milestoneId);
  const keyPrefix = await getProjectKeyPrefix(database, row.projectId);
  const milestone = toPublicMilestone(row, keyPrefix);
  const [enriched] = await withMilestoneLinks(
    database,
    row.projectId,
    keyPrefix,
    [milestone],
  );
  const [withMedia] = await withMediaLinkCounts(
    database,
    'milestone',
    [enriched ?? milestone],
  );
  return withMedia ?? enriched ?? milestone;
}

export async function getMilestone(
  database: Database,
  milestoneId: string,
): Promise<typeof projectMilestones.$inferSelect> {
  const [row] = await database.db
    .select()
    .from(projectMilestones)
    .where(eq(projectMilestones.id, milestoneId))
    .limit(1);
  if (!row) {
    throw new AppError({
      code: 'MILESTONE_NOT_FOUND',
      message: 'Milestone not found',
      statusCode: 404,
    });
  }
  return row;
}

export async function listTasks(
  database: Database,
  projectId: string,
  options?: {
    milestoneId?: string | null;
    sprintId?: string | null;
    itemType?: TaskItemType;
    includeArchived?: boolean;
  },
): Promise<PublicTask[]> {
  const conditions = [eq(projectTasks.projectId, projectId)];
  if (!options?.includeArchived) {
    conditions.push(isNull(projectTasks.archivedAt));
  }
  if (options?.itemType) {
    conditions.push(eq(projectTasks.itemType, options.itemType));
  }
  if (options?.milestoneId !== undefined) {
    if (options.milestoneId === null) {
      conditions.push(isNull(projectTasks.milestoneId));
    } else {
      conditions.push(eq(projectTasks.milestoneId, options.milestoneId));
    }
  }
  if (options?.sprintId !== undefined) {
    if (options.sprintId === null) {
      conditions.push(isNull(projectTasks.sprintId));
    } else {
      conditions.push(eq(projectTasks.sprintId, options.sprintId));
    }
  }

  const rows = await database.db
    .select()
    .from(projectTasks)
    .where(and(...conditions))
    .orderBy(asc(projectTasks.sortOrder), asc(projectTasks.dueDate));
  const keyPrefix = await getProjectKeyPrefix(database, projectId);
  return withMediaLinkCounts(
    database,
    'task',
    await withTaskContext(database, rows, new Map([[projectId, keyPrefix]])),
  );
}

export async function listAssignedTasksForUser(
  database: Database,
  userId: string,
  options?: {
    isSystemAdmin?: boolean;
    includeArchived?: boolean;
    role?: RaciRole;
  },
): Promise<PublicAssignedTask[]> {
  const conditions = [eq(projectTaskRaci.userId, userId)];
  if (!options?.includeArchived) {
    conditions.push(isNull(projectTasks.archivedAt));
    conditions.push(isNull(projects.archivedAt));
  }
  if (options?.role) {
    conditions.push(eq(projectTaskRaci.role, options.role));
  }

  const baseSelect = {
    task: projectTasks,
    myRole: projectTaskRaci.role,
    projectName: projects.name,
    projectSlug: projects.slug,
    projectKeyPrefix: projects.keyPrefix,
    workspaceId: workspaces.id,
    workspaceName: workspaces.name,
    workspaceSlug: workspaces.slug,
    milestoneTitle: projectMilestones.title,
  };

  const rows = options?.isSystemAdmin
    ? await database.db
        .select(baseSelect)
        .from(projectTaskRaci)
        .innerJoin(projectTasks, eq(projectTaskRaci.taskId, projectTasks.id))
        .innerJoin(projects, eq(projectTasks.projectId, projects.id))
        .innerJoin(workspaces, eq(projects.workspaceId, workspaces.id))
        .leftJoin(
          projectMilestones,
          eq(projectTasks.milestoneId, projectMilestones.id),
        )
        .where(and(...conditions))
    : await database.db
        .select(baseSelect)
        .from(projectTaskRaci)
        .innerJoin(projectTasks, eq(projectTaskRaci.taskId, projectTasks.id))
        .innerJoin(projects, eq(projectTasks.projectId, projects.id))
        .innerJoin(workspaces, eq(projects.workspaceId, workspaces.id))
        .innerJoin(
          memberships,
          and(
            eq(memberships.workspaceId, workspaces.id),
            eq(memberships.userId, userId),
          ),
        )
        .leftJoin(
          projectMilestones,
          eq(projectTasks.milestoneId, projectMilestones.id),
        )
        .where(and(...conditions));

  const taskRows = rows.map((row) => row.task);
  const keyPrefixByProject = new Map<string, string | null>();
  for (const row of rows) {
    keyPrefixByProject.set(row.task.projectId, row.projectKeyPrefix);
  }
  const mapped = await withTaskContext(database, taskRows, keyPrefixByProject);
  const byId = new Map(mapped.map((task) => [task.id, task]));

  const tasks: PublicAssignedTask[] = rows.map((row) => ({
    ...(byId.get(row.task.id) as PublicTask),
    myRole: raciRoleSchema.parse(row.myRole),
    projectName: row.projectName,
    projectSlug: row.projectSlug,
    workspaceId: row.workspaceId,
    workspaceName: row.workspaceName,
    workspaceSlug: row.workspaceSlug,
    milestoneTitle: row.milestoneTitle,
  }));

  tasks.sort((a, b) => {
    if (a.dueDate && b.dueDate) {
      const dueCmp = a.dueDate.localeCompare(b.dueDate);
      if (dueCmp !== 0) return dueCmp;
    } else if (a.dueDate) {
      return -1;
    } else if (b.dueDate) {
      return 1;
    }
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });

  return tasks;
}

export async function getTask(
  database: Database,
  taskId: string,
): Promise<PublicTask> {
  const [row] = await database.db
    .select()
    .from(projectTasks)
    .where(eq(projectTasks.id, taskId))
    .limit(1);
  if (!row) {
    throw new AppError({
      code: 'TASK_NOT_FOUND',
      message: 'Task not found',
      statusCode: 404,
    });
  }
  const keyPrefix = await getProjectKeyPrefix(database, row.projectId);
  const task = (
    await withTaskContext(database, [row], new Map([[row.projectId, keyPrefix]]))
  )[0]!;
  return withMediaLinks(database, 'task', task);
}

async function assertMilestoneInProject(
  database: Database,
  projectId: string,
  milestoneId: string | null | undefined,
): Promise<void> {
  if (!milestoneId) {
    return;
  }
  const [milestone] = await database.db
    .select()
    .from(projectMilestones)
    .where(
      and(
        eq(projectMilestones.id, milestoneId),
        eq(projectMilestones.projectId, projectId),
      ),
    )
    .limit(1);
  if (!milestone) {
    throw new AppError({
      code: 'MILESTONE_NOT_FOUND',
      message: 'Milestone not found in this project',
      statusCode: 400,
    });
  }
}

async function assertSprintInProject(
  database: Database,
  projectId: string,
  sprintId: string | null | undefined,
): Promise<void> {
  if (!sprintId) {
    return;
  }
  const [sprint] = await database.db
    .select()
    .from(projectSprints)
    .where(
      and(
        eq(projectSprints.id, sprintId),
        eq(projectSprints.projectId, projectId),
      ),
    )
    .limit(1);
  if (!sprint) {
    throw new AppError({
      code: 'SPRINT_NOT_FOUND',
      message: 'Sprint not found in this project',
      statusCode: 400,
    });
  }
}

function validateRaciEntries(entries: Array<{ userId: string; role: RaciRole }>): void {
  const accountable = entries.filter((entry) => entry.role === 'A');
  if (accountable.length > 1) {
    throw new AppError({
      code: 'RACI_MULTIPLE_ACCOUNTABLE',
      message: 'A task may have at most one Accountable (A)',
      statusCode: 400,
    });
  }
  const seenUsers = new Set<string>();
  for (const entry of entries) {
    if (seenUsers.has(entry.userId)) {
      throw new AppError({
        code: 'RACI_DUPLICATE_USER',
        message: 'A user may hold only one RACI role on a task',
        statusCode: 400,
      });
    }
    seenUsers.add(entry.userId);
  }
}

async function assertWorkspaceMembers(
  database: Database,
  workspaceId: string,
  userIds: string[],
): Promise<void> {
  if (userIds.length === 0) {
    return;
  }
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
      code: 'RACI_USER_NOT_MEMBER',
      message: 'All RACI users must be active members of the project workspace',
      statusCode: 400,
    });
  }
}

export async function replaceTaskRaci(
  database: Database,
  input: {
    taskId: string;
    workspaceId: string;
    entries: Array<{ userId: string; role: RaciRole }>;
    actorUserId?: string | null;
  },
): Promise<PublicRaciEntry[]> {
  validateRaciEntries(input.entries);
  await assertWorkspaceMembers(
    database,
    input.workspaceId,
    input.entries.map((entry) => entry.userId),
  );

  await database.db.transaction(async (tx) => {
    const scoped = { ...database, db: tx as unknown as Database['db'] };
    const existing = await scoped.db
      .select({
        id: projectTaskRaci.id,
        userId: projectTaskRaci.userId,
        role: projectTaskRaci.role,
      })
      .from(projectTaskRaci)
      .where(eq(projectTaskRaci.taskId, input.taskId));
    const diff = diffReplacement(
      existing,
      input.entries,
      (row) => row.userId,
      (row) => row.userId,
      (prev, row) => prev.role === row.role,
    );
    if (diff.remove.length > 0) {
      await scoped.db
        .delete(projectTaskRaci)
        .where(
          inArray(
            projectTaskRaci.id,
            diff.remove.map((row) => row.id),
          ),
        );
    }
    // One Accountable per task. Demote the current A before promoting or
    // inserting the replacement, or the partial unique index fails.
    const demotions = diff.update.filter(
      (change) => change.existing.role === 'A' && change.next.role !== 'A',
    );
    const promotions = diff.update.filter(
      (change) => change.existing.role !== 'A' && change.next.role === 'A',
    );
    const otherUpdates = diff.update.filter(
      (change) =>
        !(change.existing.role === 'A' && change.next.role !== 'A') &&
        !(change.existing.role !== 'A' && change.next.role === 'A'),
    );
    for (const change of [...demotions, ...otherUpdates, ...promotions]) {
      await scoped.db
        .update(projectTaskRaci)
        .set({ role: change.next.role })
        .where(eq(projectTaskRaci.id, change.existing.id));
    }
    if (diff.insert.length > 0) {
      await scoped.db.insert(projectTaskRaci).values(
        diff.insert.map((entry) => ({
          taskId: input.taskId,
          userId: entry.userId,
          role: entry.role,
          createdBy: input.actorUserId ?? null,
        })),
      );
    }
    await recordTaskActivity(scoped, {
      taskId: input.taskId,
      actorUserId: input.actorUserId,
      type: 'raci_changed',
      metadata: { entries: input.entries },
    });
  });

  const map = await loadRaciForTasks(database, [input.taskId]);
  return map.get(input.taskId) ?? [];
}

type StoredAiUsage = AiUsageCounts & {
  modelId: string | null;
  pricingTier: string | null;
  usageOccurredAt: Date | null;
  billingPeriod: string | null;
};

type AiUsageWrite = AiUsagePatch & {
  modelId?: string | null;
  pricingTier?: string | null;
  usageOccurredAt?: Date | null;
  billingPeriod?: string | null;
};

const EMPTY_AI_USAGE: StoredAiUsage = {
  tokensUsed: null,
  tokensInput: null,
  tokensOutput: null,
  tokensCache: null,
  modelId: null,
  pricingTier: null,
  usageOccurredAt: null,
  billingPeriod: null,
};

function storedAiUsage(row: {
  tokensUsed: number | null;
  tokensInput?: number | null;
  tokensOutput?: number | null;
  tokensCache?: number | null;
  aiModelId?: string | null;
  aiPricingTier?: string | null;
  usageOccurredAt?: Date | null;
  billingPeriod?: string | null;
}): StoredAiUsage {
  return {
    tokensUsed: row.tokensUsed ?? null,
    tokensInput: row.tokensInput ?? null,
    tokensOutput: row.tokensOutput ?? null,
    tokensCache: row.tokensCache ?? null,
    modelId: row.aiModelId ?? null,
    pricingTier: row.aiPricingTier ?? null,
    usageOccurredAt: row.usageOccurredAt ?? null,
    billingPeriod: row.billingPeriod ?? null,
  };
}

function resolveAiUsageWrite(
  existing: StoredAiUsage,
  input: AiUsageWrite,
): StoredAiUsage {
  const counts = mergeAiUsage(existing, input);
  return {
    ...counts,
    modelId:
      input.modelId !== undefined ? input.modelId ?? null : existing.modelId,
    pricingTier:
      input.pricingTier !== undefined
        ? input.pricingTier ?? null
        : existing.pricingTier,
    usageOccurredAt:
      input.usageOccurredAt !== undefined
        ? input.usageOccurredAt ?? null
        : existing.usageOccurredAt,
    billingPeriod:
      input.billingPeriod !== undefined
        ? input.billingPeriod ?? null
        : existing.billingPeriod,
  };
}

function sameInstant(left: Date | null, right: Date | null): boolean {
  if (left == null || right == null) return left == null && right == null;
  return left.getTime() === right.getTime();
}

function usageActivityDelta(
  before: StoredAiUsage,
  after: StoredAiUsage,
  input: AiUsageWrite,
  aiSystem: { before: string | null; after: string | null; touched: boolean },
): { fields: string[]; previous: Record<string, unknown> } {
  const fields: string[] = [];
  const previous: Record<string, unknown> = {};
  const consider = (
    key: string,
    touched: boolean,
    prev: unknown,
    changed: boolean,
  ) => {
    if (!touched && !changed) return;
    fields.push(key);
    previous[key] = prev;
  };
  consider(
    'tokensUsed',
    input.tokensUsed !== undefined,
    before.tokensUsed,
    before.tokensUsed !== after.tokensUsed,
  );
  consider(
    'tokensInput',
    input.tokensInput !== undefined,
    before.tokensInput,
    before.tokensInput !== after.tokensInput,
  );
  consider(
    'tokensOutput',
    input.tokensOutput !== undefined,
    before.tokensOutput,
    before.tokensOutput !== after.tokensOutput,
  );
  consider(
    'tokensCache',
    input.tokensCache !== undefined,
    before.tokensCache,
    before.tokensCache !== after.tokensCache,
  );
  consider(
    'modelId',
    input.modelId !== undefined,
    before.modelId,
    before.modelId !== after.modelId,
  );
  consider(
    'pricingTier',
    input.pricingTier !== undefined,
    before.pricingTier,
    before.pricingTier !== after.pricingTier,
  );
  consider(
    'usageOccurredAt',
    input.usageOccurredAt !== undefined,
    before.usageOccurredAt?.toISOString() ?? null,
    !sameInstant(before.usageOccurredAt, after.usageOccurredAt),
  );
  consider(
    'billingPeriod',
    input.billingPeriod !== undefined,
    before.billingPeriod,
    before.billingPeriod !== after.billingPeriod,
  );
  consider(
    'aiSystemId',
    aiSystem.touched,
    aiSystem.before,
    aiSystem.before !== aiSystem.after,
  );
  return { fields, previous };
}

export function taskTouchesCost(input: {
  forecastHours?: unknown;
  actualHours?: unknown;
  tokensUsed?: unknown;
  tokensInput?: unknown;
  tokensOutput?: unknown;
  tokensCache?: unknown;
  modelId?: unknown;
  pricingTier?: unknown;
  usageOccurredAt?: unknown;
  billingPeriod?: unknown;
  aiSystemId?: unknown;
}): boolean {
  return (
    input.forecastHours !== undefined ||
    input.actualHours !== undefined ||
    input.tokensUsed !== undefined ||
    input.tokensInput !== undefined ||
    input.tokensOutput !== undefined ||
    input.tokensCache !== undefined ||
    input.modelId !== undefined ||
    input.pricingTier !== undefined ||
    input.usageOccurredAt !== undefined ||
    input.billingPeriod !== undefined ||
    input.aiSystemId !== undefined
  );
}

function requireBugWrite(
  result: BugWriteResult,
): { itemType: TaskItemType; fields: StoredBugFields } {
  if (!result.ok) {
    throw new AppError({
      code: result.code,
      message: result.message,
      statusCode: 400,
    });
  }
  return { itemType: result.itemType, fields: result.fields };
}

function bugPatchFrom(input: BugFieldPatch): BugFieldPatch {
  return {
    severity: input.severity,
    foundIn: input.foundIn,
    foundInNote: input.foundInNote,
    stepsToReproduce: input.stepsToReproduce,
    expectedBehavior: input.expectedBehavior,
    actualBehavior: input.actualBehavior,
    resolution: input.resolution,
    regression: input.regression,
    affectedSystemId: input.affectedSystemId,
    duplicateOfTaskId: input.duplicateOfTaskId,
  };
}

function bugColumns(write: { itemType: TaskItemType; fields: StoredBugFields }) {
  return {
    itemType: write.itemType,
    severity: write.fields.severity,
    foundIn: write.fields.foundIn,
    foundInNote: write.fields.foundInNote,
    stepsToReproduce: write.fields.stepsToReproduce,
    expectedBehavior: write.fields.expectedBehavior,
    actualBehavior: write.fields.actualBehavior,
    resolution: write.fields.resolution,
    regression: write.fields.regression,
    affectedSystemId: write.fields.affectedSystemId,
    duplicateOfTaskId: write.fields.duplicateOfTaskId,
  };
}

function storedBugFromRow(
  row: typeof projectTasks.$inferSelect,
): StoredBugFields {
  return {
    severity: row.severity ? raidSeveritySchema.parse(row.severity) : null,
    foundIn: row.foundIn ? bugFoundInSchema.parse(row.foundIn) : null,
    foundInNote: row.foundInNote,
    stepsToReproduce: row.stepsToReproduce,
    expectedBehavior: row.expectedBehavior,
    actualBehavior: row.actualBehavior,
    resolution: row.resolution ? bugResolutionSchema.parse(row.resolution) : null,
    regression: row.regression ?? false,
    affectedSystemId: row.affectedSystemId ?? null,
    duplicateOfTaskId: row.duplicateOfTaskId ?? null,
  };
}

function changedBugFields(
  before: StoredBugFields,
  after: StoredBugFields,
): string[] {
  const keys = [
    'severity',
    'foundIn',
    'foundInNote',
    'stepsToReproduce',
    'expectedBehavior',
    'actualBehavior',
    'resolution',
    'regression',
    'affectedSystemId',
    'duplicateOfTaskId',
  ] as const;
  return keys.filter((key) => before[key] !== after[key]);
}

async function projectWorkspaceId(
  database: Database,
  projectId: string,
): Promise<string | null> {
  const [project] = await database.db
    .select({ workspaceId: projects.workspaceId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  return project?.workspaceId ?? null;
}

async function assertAffectedSystem(
  database: Database,
  projectId: string,
  workspaceId: string,
  systemId: string | null,
): Promise<void> {
  if (!systemId) return;
  const [system] = await database.db
    .select({
      id: systems.id,
      projectId: systems.projectId,
      workspaceId: systems.workspaceId,
      archivedAt: systems.archivedAt,
    })
    .from(systems)
    .where(eq(systems.id, systemId))
    .limit(1);
  if (!system || system.archivedAt || system.workspaceId !== workspaceId) {
    throw new AppError({
      code: 'SYSTEM_NOT_FOUND',
      message: 'Affected system not found',
      statusCode: 404,
    });
  }
  if (system.projectId !== projectId) {
    throw new AppError({
      code: 'SYSTEM_NOT_IN_PROJECT',
      message: 'Affected system is not linked to this project',
      statusCode: 400,
    });
  }
}

async function assertDuplicateTarget(
  database: Database,
  input: {
    projectId: string;
    taskId: string | null;
    duplicateOfTaskId: string | null;
  },
): Promise<void> {
  if (!input.duplicateOfTaskId) return;
  if (input.taskId && input.duplicateOfTaskId === input.taskId) {
    throw new AppError({
      code: 'BUG_DUPLICATE_SELF',
      message: 'A bug cannot be a duplicate of itself',
      statusCode: 400,
    });
  }

  const seen = new Set<string>();
  if (input.taskId) seen.add(input.taskId);
  let cursor: string | null = input.duplicateOfTaskId;
  let first = true;
  while (cursor) {
    if (seen.has(cursor)) {
      throw new AppError({
        code: 'BUG_DUPLICATE_CYCLE',
        message: 'Duplicate links cannot form a cycle',
        statusCode: 400,
      });
    }
    seen.add(cursor);
    const [row] = await database.db
      .select({
        id: projectTasks.id,
        projectId: projectTasks.projectId,
        itemType: projectTasks.itemType,
        duplicateOfTaskId: projectTasks.duplicateOfTaskId,
        archivedAt: projectTasks.archivedAt,
      })
      .from(projectTasks)
      .where(eq(projectTasks.id, cursor))
      .limit(1);
    if (!row || row.projectId !== input.projectId) {
      throw new AppError({
        code: 'BUG_DUPLICATE_NOT_FOUND',
        message: 'Duplicate target was not found in this project',
        statusCode: 400,
      });
    }
    if (first) {
      if (row.itemType !== 'bug') {
        throw new AppError({
          code: 'BUG_DUPLICATE_NOT_BUG',
          message: 'Duplicate target must be a bug',
          statusCode: 400,
        });
      }
      if (row.archivedAt) {
        throw new AppError({
          code: 'BUG_DUPLICATE_ARCHIVED',
          message: 'Duplicate target is archived',
          statusCode: 400,
        });
      }
      first = false;
    }
    cursor = row.duplicateOfTaskId;
  }
}

export async function createTask(
  database: Database,
  input: {
    projectId: string;
    workspaceId: string;
    title: string;
    description?: string | null;
    status?: TaskStatus;
    startDate?: string | null;
    dueDate?: string | null;
    durationDays?: number | null;
    forecastHours?: number | null;
    actualHours?: number | null;
    tokensUsed?: number | null;
    tokensInput?: number | null;
    tokensOutput?: number | null;
    tokensCache?: number | null;
    modelId?: string | null;
    pricingTier?: string | null;
    usageOccurredAt?: Date | null;
    billingPeriod?: string | null;
    aiSystemId?: string | null;
    milestoneId?: string | null;
    userStoryId?: string | null;
    sprintId?: string | null;
    storyPoints?: number | null;
    completionPercent?: number | null;
    currentOwnerUserId?: string | null;
    sortOrder?: number;
    createdBy?: string | null;
    raci?: Array<{ userId: string; role: RaciRole }>;
    itemType?: TaskItemType;
    severity?: RaidSeverity | null;
    foundIn?: BugFoundIn | null;
    foundInNote?: string | null;
    stepsToReproduce?: string | null;
    expectedBehavior?: string | null;
    actualBehavior?: string | null;
    resolution?: BugResolution | null;
    regression?: boolean | null;
    affectedSystemId?: string | null;
    duplicateOfTaskId?: string | null;
  },
): Promise<PublicTask> {
  const itemType = input.itemType ?? 'task';
  const bugWrite = requireBugWrite(resolveBugCreate(itemType, bugPatchFrom(input)));
  await assertAffectedSystem(
    database,
    input.projectId,
    input.workspaceId,
    bugWrite.fields.affectedSystemId,
  );
  await assertDuplicateTarget(database, {
    projectId: input.projectId,
    taskId: null,
    duplicateOfTaskId: bugWrite.fields.duplicateOfTaskId,
  });
  await assertMilestoneInProject(database, input.projectId, input.milestoneId);
  await assertUserStoryInProject(database, input.projectId, input.userStoryId);
  await assertSprintInProject(database, input.projectId, input.sprintId);
  if (input.aiSystemId) {
    await assertAiAssistantForProject(
      database,
      input.projectId,
      input.workspaceId,
      input.aiSystemId,
    );
  }
  if (input.raci) {
    validateRaciEntries(input.raci);
    await assertWorkspaceMembers(
      database,
      input.workspaceId,
      input.raci.map((entry) => entry.userId),
    );
  }
  if (input.currentOwnerUserId) {
    await assertWorkspaceMembers(database, input.workspaceId, [
      input.currentOwnerUserId,
    ]);
  }

  const schedulePatch = {
    startDate: input.startDate,
    dueDate: input.dueDate,
    durationDays: input.durationDays,
  };
  // Reject an inverted explicit range before the calendar query. Duration
  // still needs the project calendar, because it rewrites the due date.
  if (schedulePatch.durationDays == null) {
    resolveTaskScheduleDates({
      stored: { startDate: null, dueDate: null, durationDays: null },
      patch: schedulePatch,
    });
  }
  const scheduledDates = resolveTaskScheduleDates({
    stored: { startDate: null, dueDate: null, durationDays: null },
    patch: schedulePatch,
    calendar: await loadProjectCalendar(database, input.projectId),
  });

  const ownerUserId =
    input.currentOwnerUserId ??
    defaultOwnerFromRaci(input.raci ?? [], input.createdBy);
  const usage = resolveAiUsageWrite(EMPTY_AI_USAGE, input);
  // A chosen percent sets status when the caller did not send one, or when it changed.
  const status = statusForTaskCompletionChange({
    status: input.status ?? 'todo',
    requested: input.completionPercent,
  });
  const completionPercent = resolveTaskCompletionPercent({
    status,
    requested: input.completionPercent,
  });

  const createdTask = await database.db.transaction(async (tx) => {
    const allocated = await allocateIssueNumber(
      database,
      input.projectId,
      bugWrite.itemType === 'bug' ? 'B' : 'T',
      tx,
    );
    const [row] = await tx
      .insert(projectTasks)
      .values({
        projectId: input.projectId,
        milestoneId: input.milestoneId ?? null,
        userStoryId: input.userStoryId ?? null,
        sprintId: input.sprintId ?? null,
        title: input.title,
        description: input.description ?? null,
        ...bugColumns(bugWrite),
        status,
        startDate: scheduledDates.startDate,
        dueDate: scheduledDates.dueDate,
        durationDays: scheduledDates.durationDays,
        forecastHours: input.forecastHours ?? null,
        actualHours: input.actualHours ?? null,
        storyPoints: input.storyPoints ?? null,
        completionPercent,
        tokensUsed: usage.tokensUsed,
        tokensInput: usage.tokensInput,
        tokensOutput: usage.tokensOutput,
        tokensCache: usage.tokensCache,
        aiModelId: usage.modelId,
        aiPricingTier: usage.pricingTier,
        usageOccurredAt: usage.usageOccurredAt,
        billingPeriod: usage.billingPeriod,
        aiSystemId: input.aiSystemId ?? null,
        sortOrder: input.sortOrder ?? 0,
        createdBy: input.createdBy ?? null,
        currentOwnerUserId: ownerUserId,
        issueKeyType: allocated.issueKeyType,
        issueNumber: allocated.issueNumber,
      })
      .returning();

    if (!row) {
      throw new AppError({
        code: 'TASK_CREATE_FAILED',
        message: 'Failed to create task',
        statusCode: 500,
      });
    }

    if (input.raci && input.raci.length > 0) {
      await tx.insert(projectTaskRaci).values(
        input.raci.map((entry) => ({
          taskId: row.id,
          userId: entry.userId,
          role: entry.role,
          createdBy: input.createdBy ?? null,
        })),
      );
    }

    return row;
  });

  await recordTaskActivity(database, {
    taskId: createdTask.id,
    actorUserId: input.createdBy,
    type: 'created',
    metadata: {
      title: createdTask.title,
      currentOwnerUserId: ownerUserId,
      userStoryId: createdTask.userStoryId,
    },
  });

  let dateChanges: Array<{
    entityType: 'task' | 'user_story' | 'epic' | 'milestone' | 'sprint';
    id: string;
  }> = [];
  if (createdTask.userStoryId) {
    const applied = await recomputeDeliveryParentStatuses(database, createdTask.projectId, {
      storyIds: [createdTask.userStoryId],
      taskIds: [createdTask.id],
    });
    dateChanges = applied.dateChanges;
  }
  await rescheduleDeliveryFrom(database, createdTask.projectId, [
    { entityType: 'task', id: createdTask.id },
    ...dateChanges,
  ]);

  return getTask(database, createdTask.id);
}

export async function deleteTask(
  database: Database,
  taskId: string,
): Promise<{ id: string; projectId: string }> {
  const existing = await getTask(database, taskId);
  const milestoneIds = await milestoneIdsForDeliveryEntities(database, existing.projectId, {
    taskIds: [existing.id],
    storyIds: [existing.userStoryId],
    epicIds: [existing.epicId],
  });
  await deleteDeliveryDependenciesFor(database, 'task', [taskId]);
  await deleteMilestoneItemLinks(database, 'task', [taskId]);
  await database.db.delete(projectTasks).where(eq(projectTasks.id, taskId));
  const applied = await recomputeDeliveryParentStatuses(database, existing.projectId, {
    storyIds: [existing.userStoryId],
    epicIds: [existing.epicId],
    milestoneIds,
  });
  const seeds = [...applied.dateChanges];
  if (existing.userStoryId) {
    seeds.push({ entityType: 'user_story', id: existing.userStoryId });
  }
  if (existing.epicId) seeds.push({ entityType: 'epic', id: existing.epicId });
  for (const id of milestoneIds) seeds.push({ entityType: 'milestone', id });
  if (seeds.length > 0) {
    await rescheduleDeliveryFrom(database, existing.projectId, seeds);
  }
  return { id: existing.id, projectId: existing.projectId };
}

export async function updateTask(
  database: Database,
  taskId: string,
  input: {
    title?: string;
    description?: string | null;
    status?: TaskStatus;
    startDate?: string | null;
    dueDate?: string | null;
    durationDays?: number | null;
    forecastHours?: number | null;
    actualHours?: number | null;
    tokensUsed?: number | null;
    tokensInput?: number | null;
    tokensOutput?: number | null;
    tokensCache?: number | null;
    modelId?: string | null;
    pricingTier?: string | null;
    usageOccurredAt?: Date | null;
    billingPeriod?: string | null;
    aiSystemId?: string | null;
    milestoneId?: string | null;
    userStoryId?: string | null;
    sprintId?: string | null;
    storyPoints?: number | null;
    completionPercent?: number | null;
    currentOwnerUserId?: string | null;
    sortOrder?: number;
    archived?: boolean;
    actorUserId?: string | null;
    workspaceId?: string;
    itemType?: TaskItemType;
    severity?: RaidSeverity | null;
    foundIn?: BugFoundIn | null;
    foundInNote?: string | null;
    stepsToReproduce?: string | null;
    expectedBehavior?: string | null;
    actualBehavior?: string | null;
    resolution?: BugResolution | null;
    regression?: boolean | null;
    affectedSystemId?: string | null;
    duplicateOfTaskId?: string | null;
  },
): Promise<PublicTask> {
  const [existing] = await database.db
    .select()
    .from(projectTasks)
    .where(eq(projectTasks.id, taskId))
    .limit(1);
  if (!existing) {
    throw new AppError({
      code: 'TASK_NOT_FOUND',
      message: 'Task not found',
      statusCode: 404,
    });
  }

  const bugWrite = requireBugWrite(
    resolveBugUpdate({
      existingItemType: taskItemTypeSchema.parse(existing.itemType ?? 'task'),
      existing: storedBugFromRow(existing),
      itemType: input.itemType,
      patch: bugPatchFrom(input),
    }),
  );
  const workspaceId =
    input.workspaceId ??
    (bugWrite.fields.affectedSystemId
      ? await projectWorkspaceId(database, existing.projectId)
      : null);
  if (bugWrite.fields.affectedSystemId) {
    if (!workspaceId) {
      throw new AppError({
        code: 'PROJECT_NOT_FOUND',
        message: 'Project not found',
        statusCode: 404,
      });
    }
    await assertAffectedSystem(
      database,
      existing.projectId,
      workspaceId,
      bugWrite.fields.affectedSystemId,
    );
  }
  await assertDuplicateTarget(database, {
    projectId: existing.projectId,
    taskId: existing.id,
    duplicateOfTaskId: bugWrite.fields.duplicateOfTaskId,
  });

  if (input.milestoneId !== undefined) {
    await assertMilestoneInProject(database, existing.projectId, input.milestoneId);
  }
  if (input.userStoryId !== undefined) {
    await assertUserStoryInProject(database, existing.projectId, input.userStoryId);
  }
  if (input.sprintId !== undefined) {
    await assertSprintInProject(database, existing.projectId, input.sprintId);
  }
  if (input.aiSystemId !== undefined && input.aiSystemId !== null) {
    const [project] = await database.db
      .select({ workspaceId: projects.workspaceId })
      .from(projects)
      .where(eq(projects.id, existing.projectId))
      .limit(1);
    if (!project) {
      throw new AppError({
        code: 'PROJECT_NOT_FOUND',
        message: 'Project not found',
        statusCode: 404,
      });
    }
    await assertAiAssistantForProject(
      database,
      existing.projectId,
      project.workspaceId,
      input.aiSystemId,
    );
  }
  if (input.currentOwnerUserId && input.workspaceId) {
    await assertWorkspaceMembers(database, input.workspaceId, [
      input.currentOwnerUserId,
    ]);
  }

  const scheduleStored = {
    startDate: existing.startDate,
    dueDate: existing.dueDate,
    durationDays: existing.durationDays,
  };
  const schedulePatch = {
    startDate: input.startDate,
    dueDate: input.dueDate,
    durationDays: input.durationDays,
  };
  if (schedulePatch.durationDays == null) {
    resolveTaskScheduleDates({
      stored: scheduleStored,
      patch: schedulePatch,
    });
  }
  const scheduledDates = resolveTaskScheduleDates({
    stored: scheduleStored,
    patch: schedulePatch,
    calendar: await loadProjectCalendar(database, existing.projectId),
  });

  // An explicit status is the caller's choice (the dialog already moved it
  // when the percent changed). A percent-only patch still drives status.
  const nextStatus =
    input.status !== undefined
      ? taskStatusSchema.parse(input.status)
      : statusForTaskCompletionChange({
          status: taskStatusSchema.parse(existing.status),
          requested: input.completionPercent,
          existing: existing.completionPercent,
        });
  const completionPercent = resolveTaskCompletionPercent({
    status: nextStatus,
    requested: input.completionPercent,
    existing: existing.completionPercent,
  });
  const nextOwner =
    input.currentOwnerUserId !== undefined
      ? input.currentOwnerUserId
      : existing.currentOwnerUserId;
  const beforeUsage = storedAiUsage(existing);
  const usage = resolveAiUsageWrite(beforeUsage, input);
  const nextAiSystemId =
    input.aiSystemId !== undefined ? input.aiSystemId : existing.aiSystemId;

  await database.db
    .update(projectTasks)
    .set({
      title: input.title ?? existing.title,
      description:
        input.description !== undefined ? input.description : existing.description,
      ...bugColumns(bugWrite),
      status: nextStatus,
      startDate: scheduledDates.startDate,
      dueDate: scheduledDates.dueDate,
      durationDays: scheduledDates.durationDays,
      forecastHours:
        input.forecastHours !== undefined
          ? input.forecastHours
          : existing.forecastHours,
      actualHours:
        input.actualHours !== undefined
          ? input.actualHours
          : existing.actualHours,
      tokensUsed: usage.tokensUsed,
      tokensInput: usage.tokensInput,
      tokensOutput: usage.tokensOutput,
      tokensCache: usage.tokensCache,
      aiModelId: usage.modelId,
      aiPricingTier: usage.pricingTier,
      usageOccurredAt: usage.usageOccurredAt,
      billingPeriod: usage.billingPeriod,
      aiSystemId: nextAiSystemId,
      milestoneId:
        input.milestoneId !== undefined ? input.milestoneId : existing.milestoneId,
      userStoryId:
        input.userStoryId !== undefined ? input.userStoryId : existing.userStoryId,
      sprintId: input.sprintId !== undefined ? input.sprintId : existing.sprintId,
      storyPoints:
        input.storyPoints !== undefined ? input.storyPoints : existing.storyPoints,
      completionPercent,
      currentOwnerUserId: nextOwner,
      sortOrder: input.sortOrder ?? existing.sortOrder,
      archivedAt:
        input.archived === undefined
          ? existing.archivedAt
          : input.archived
            ? existing.archivedAt ?? new Date()
            : null,
      updatedAt: new Date(),
    })
    .where(eq(projectTasks.id, taskId));

  if (nextStatus !== existing.status) {
    await recordTaskActivity(database, {
      taskId,
      actorUserId: input.actorUserId,
      type: 'status_changed',
      metadata: { from: existing.status, to: nextStatus },
    });
  }
  if (
    input.currentOwnerUserId !== undefined &&
    input.currentOwnerUserId !== existing.currentOwnerUserId
  ) {
    await recordTaskActivity(database, {
      taskId,
      actorUserId: input.actorUserId,
      type: 'owner_set',
      metadata: {
        fromUserId: existing.currentOwnerUserId,
        toUserId: input.currentOwnerUserId,
      },
    });
  }
  const fieldKeys = [
    'title',
    'description',
    'startDate',
    'dueDate',
    'durationDays',
    'forecastHours',
    'actualHours',
    'completionPercent',
    'milestoneId',
    'userStoryId',
    'sortOrder',
    'archived',
  ] as const;
  const changedFields = [
    ...fieldKeys.filter((key) => input[key] !== undefined),
    ...changedBugFields(storedBugFromRow(existing), bugWrite.fields),
  ];
  const usageDelta = usageActivityDelta(beforeUsage, usage, input, {
    before: existing.aiSystemId,
    after: nextAiSystemId,
    touched: input.aiSystemId !== undefined,
  });
  const fields = [...changedFields, ...usageDelta.fields];
  if (fields.length > 0) {
    await recordTaskActivity(database, {
      taskId,
      actorUserId: input.actorUserId,
      type: 'fields_updated',
      metadata: {
        fields,
        ...(Object.keys(usageDelta.previous).length > 0
          ? { previous: usageDelta.previous }
          : {}),
      },
    });
  }

  const parentTouched =
    input.status !== undefined ||
    input.completionPercent !== undefined ||
    input.userStoryId !== undefined ||
    input.archived !== undefined ||
    input.startDate !== undefined ||
    input.dueDate !== undefined ||
    input.durationDays !== undefined;
  let dateChanges: Array<{
    entityType: 'task' | 'user_story' | 'epic' | 'milestone' | 'sprint';
    id: string;
  }> = [];
  if (parentTouched) {
    const nextStoryId =
      input.userStoryId !== undefined ? input.userStoryId : existing.userStoryId;
    const applied = await recomputeDeliveryParentStatuses(database, existing.projectId, {
      storyIds: [existing.userStoryId, nextStoryId],
      taskIds: [taskId],
    });
    dateChanges = applied.dateChanges;
  }
  await rescheduleDeliveryFrom(database, existing.projectId, [
    { entityType: 'task', id: taskId },
    ...dateChanges,
  ]);
  return getTask(database, taskId);
}
