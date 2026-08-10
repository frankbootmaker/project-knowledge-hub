import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { Database } from '@project-knowledge-hub/database';
import {
  memberships,
  projectEpics,
  projectMilestones,
  projectTaskActivities,
  projectTaskRaci,
  projectTasks,
  projectUserStories,
  projects,
  users,
  workspaces,
} from '@project-knowledge-hub/database';
import {
  AppError,
  milestoneStatusSchema,
  raciRoleSchema,
  taskActivityTypeSchema,
  taskStatusSchema,
  type MilestoneStatus,
  type RaciRole,
  type TaskActivityType,
  type TaskStatus,
} from '@project-knowledge-hub/domain';

export type PublicRaciEntry = {
  userId: string;
  displayName: string;
  email: string;
  role: RaciRole;
};

export type PublicTaskOwner = {
  userId: string;
  displayName: string;
  email: string;
};

export type PublicMilestone = {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  status: MilestoneStatus;
  targetDate: string | null;
  sortOrder: number;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PublicTask = {
  id: string;
  projectId: string;
  milestoneId: string | null;
  userStoryId: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  dueDate: string | null;
  sortOrder: number;
  createdBy: string | null;
  currentOwnerUserId: string | null;
  currentOwner: PublicTaskOwner | null;
  userStoryTitle: string | null;
  epicId: string | null;
  epicTitle: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  raci: PublicRaciEntry[];
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
): PublicMilestone {
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    description: row.description,
    status: milestoneStatusSchema.parse(row.status),
    targetDate: row.targetDate,
    sortOrder: row.sortOrder,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
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
  },
): PublicTask {
  return {
    id: row.id,
    projectId: row.projectId,
    milestoneId: row.milestoneId,
    userStoryId: row.userStoryId,
    title: row.title,
    description: row.description,
    status: taskStatusSchema.parse(row.status),
    dueDate: row.dueDate,
    sortOrder: row.sortOrder,
    createdBy: row.createdBy,
    currentOwnerUserId: row.currentOwnerUserId,
    currentOwner: extras?.currentOwner ?? null,
    userStoryTitle: extras?.userStoryTitle ?? null,
    epicId: extras?.epicId ?? null,
    epicTitle: extras?.epicTitle ?? null,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    raci,
  };
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
      })
      .from(users)
      .where(inArray(users.id, ownerIds));
    for (const owner of ownerRows) {
      owners.set(owner.userId, owner);
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
    });
  });
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
    })
    .from(projectTaskRaci)
    .innerJoin(users, eq(projectTaskRaci.userId, users.id))
    .where(inArray(projectTaskRaci.taskId, taskIds));

  for (const row of rows) {
    const entry: PublicRaciEntry = {
      userId: row.userId,
      displayName: row.displayName,
      email: row.email,
      role: raciRoleSchema.parse(row.role),
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
  return rows.map(toPublicMilestone);
}

export async function createMilestone(
  database: Database,
  input: {
    projectId: string;
    title: string;
    description?: string | null;
    status?: MilestoneStatus;
    targetDate?: string | null;
    sortOrder?: number;
  },
): Promise<PublicMilestone> {
  const [row] = await database.db
    .insert(projectMilestones)
    .values({
      projectId: input.projectId,
      title: input.title,
      description: input.description ?? null,
      status: input.status ?? 'planned',
      targetDate: input.targetDate ?? null,
      sortOrder: input.sortOrder ?? 0,
    })
    .returning();
  if (!row) {
    throw new AppError({
      code: 'MILESTONE_CREATE_FAILED',
      message: 'Failed to create milestone',
      statusCode: 500,
    });
  }
  return toPublicMilestone(row);
}

export async function updateMilestone(
  database: Database,
  milestoneId: string,
  input: {
    title?: string;
    description?: string | null;
    status?: MilestoneStatus;
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
  return toPublicMilestone(row);
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
  options?: { milestoneId?: string | null; includeArchived?: boolean },
): Promise<PublicTask[]> {
  const conditions = [eq(projectTasks.projectId, projectId)];
  if (!options?.includeArchived) {
    conditions.push(isNull(projectTasks.archivedAt));
  }
  if (options?.milestoneId !== undefined) {
    if (options.milestoneId === null) {
      conditions.push(isNull(projectTasks.milestoneId));
    } else {
      conditions.push(eq(projectTasks.milestoneId, options.milestoneId));
    }
  }

  const rows = await database.db
    .select()
    .from(projectTasks)
    .where(and(...conditions))
    .orderBy(asc(projectTasks.sortOrder), asc(projectTasks.dueDate));
  const raciMap = await loadRaciForTasks(
    database,
    rows.map((row) => row.id),
  );
  const { owners, stories } = await loadTaskContext(database, rows);
  return mapTasksWithContext(rows, raciMap, owners, stories);
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

  const raciMap = await loadRaciForTasks(
    database,
    rows.map((row) => row.task.id),
  );

  const taskRows = rows.map((row) => row.task);
  const { owners, stories } = await loadTaskContext(database, taskRows);
  const mapped = mapTasksWithContext(taskRows, raciMap, owners, stories);
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
  const raciMap = await loadRaciForTasks(database, [row.id]);
  const { owners, stories } = await loadTaskContext(database, [row]);
  return mapTasksWithContext([row], raciMap, owners, stories)[0]!;
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
        eq(users.status, 'active'),
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

  await database.db
    .delete(projectTaskRaci)
    .where(eq(projectTaskRaci.taskId, input.taskId));

  if (input.entries.length > 0) {
    await database.db.insert(projectTaskRaci).values(
      input.entries.map((entry) => ({
        taskId: input.taskId,
        userId: entry.userId,
        role: entry.role,
      })),
    );
  }

  await recordTaskActivity(database, {
    taskId: input.taskId,
    actorUserId: input.actorUserId,
    type: 'raci_changed',
    metadata: { entries: input.entries },
  });

  const map = await loadRaciForTasks(database, [input.taskId]);
  return map.get(input.taskId) ?? [];
}

export async function createTask(
  database: Database,
  input: {
    projectId: string;
    workspaceId: string;
    title: string;
    description?: string | null;
    status?: TaskStatus;
    dueDate?: string | null;
    milestoneId?: string | null;
    userStoryId?: string | null;
    currentOwnerUserId?: string | null;
    sortOrder?: number;
    createdBy?: string | null;
    raci?: Array<{ userId: string; role: RaciRole }>;
  },
): Promise<PublicTask> {
  await assertMilestoneInProject(database, input.projectId, input.milestoneId);
  await assertUserStoryInProject(database, input.projectId, input.userStoryId);
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

  const ownerUserId =
    input.currentOwnerUserId ??
    defaultOwnerFromRaci(input.raci ?? [], input.createdBy);

  const [row] = await database.db
    .insert(projectTasks)
    .values({
      projectId: input.projectId,
      milestoneId: input.milestoneId ?? null,
      userStoryId: input.userStoryId ?? null,
      title: input.title,
      description: input.description ?? null,
      status: input.status ?? 'todo',
      dueDate: input.dueDate ?? null,
      sortOrder: input.sortOrder ?? 0,
      createdBy: input.createdBy ?? null,
      currentOwnerUserId: ownerUserId,
    })
    .returning();

  if (!row) {
    throw new AppError({
      code: 'TASK_CREATE_FAILED',
      message: 'Failed to create task',
      statusCode: 500,
    });
  }
  const createdTask = row;

  if (input.raci && input.raci.length > 0) {
    await database.db.insert(projectTaskRaci).values(
      input.raci.map((entry) => ({
        taskId: createdTask.id,
        userId: entry.userId,
        role: entry.role,
      })),
    );
  }

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

  return getTask(database, createdTask.id);
}

export async function updateTask(
  database: Database,
  taskId: string,
  input: {
    title?: string;
    description?: string | null;
    status?: TaskStatus;
    dueDate?: string | null;
    milestoneId?: string | null;
    userStoryId?: string | null;
    currentOwnerUserId?: string | null;
    sortOrder?: number;
    archived?: boolean;
    actorUserId?: string | null;
    workspaceId?: string;
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

  if (input.milestoneId !== undefined) {
    await assertMilestoneInProject(database, existing.projectId, input.milestoneId);
  }
  if (input.userStoryId !== undefined) {
    await assertUserStoryInProject(database, existing.projectId, input.userStoryId);
  }
  if (input.currentOwnerUserId && input.workspaceId) {
    await assertWorkspaceMembers(database, input.workspaceId, [
      input.currentOwnerUserId,
    ]);
  }

  const nextStatus = input.status ?? existing.status;
  const nextOwner =
    input.currentOwnerUserId !== undefined
      ? input.currentOwnerUserId
      : existing.currentOwnerUserId;

  await database.db
    .update(projectTasks)
    .set({
      title: input.title ?? existing.title,
      description:
        input.description !== undefined ? input.description : existing.description,
      status: nextStatus,
      dueDate: input.dueDate !== undefined ? input.dueDate : existing.dueDate,
      milestoneId:
        input.milestoneId !== undefined ? input.milestoneId : existing.milestoneId,
      userStoryId:
        input.userStoryId !== undefined ? input.userStoryId : existing.userStoryId,
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

  if (input.status !== undefined && input.status !== existing.status) {
    await recordTaskActivity(database, {
      taskId,
      actorUserId: input.actorUserId,
      type: 'status_changed',
      metadata: { from: existing.status, to: input.status },
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
    'dueDate',
    'milestoneId',
    'userStoryId',
    'sortOrder',
    'archived',
  ] as const;
  const changedFields = fieldKeys.filter((key) => input[key] !== undefined);
  if (changedFields.length > 0) {
    await recordTaskActivity(database, {
      taskId,
      actorUserId: input.actorUserId,
      type: 'fields_updated',
      metadata: { fields: changedFields },
    });
  }

  return getTask(database, taskId);
}
