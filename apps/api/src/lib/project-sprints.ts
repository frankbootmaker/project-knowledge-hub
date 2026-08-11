import { and, asc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import {
  projectSprints,
  projectTaskActivities,
  projectTasks,
  type Database,
} from '@project-knowledge-hub/database';
import {
  AppError,
  sprintStatusSchema,
  type SprintStatus,
} from '@project-knowledge-hub/domain';
import {
  allocateIssueNumber,
  getProjectKeyPrefix,
  toHumanKeyFields,
} from './project-issue-keys.js';

export type PublicSprint = {
  id: string;
  projectId: string;
  name: string;
  goal: string | null;
  status: SprintStatus;
  startDate: string | null;
  endDate: string | null;
  capacityPoints: number | null;
  committedPoints: number;
  donePoints: number;
  sortOrder: number;
  issueKeyType: string | null;
  issueNumber: number | null;
  humanKey: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

function toPublicSprint(
  row: typeof projectSprints.$inferSelect,
  extras?: {
    keyPrefix?: string | null;
    committedPoints?: number;
    donePoints?: number;
  },
): PublicSprint {
  const keys = toHumanKeyFields(
    extras?.keyPrefix,
    row.issueKeyType,
    row.issueNumber,
  );
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    goal: row.goal,
    status: sprintStatusSchema.parse(row.status),
    startDate: row.startDate,
    endDate: row.endDate,
    capacityPoints: row.capacityPoints,
    committedPoints: extras?.committedPoints ?? 0,
    donePoints: extras?.donePoints ?? 0,
    sortOrder: row.sortOrder,
    issueKeyType: keys.issueKeyType,
    issueNumber: keys.issueNumber,
    humanKey: keys.humanKey,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function loadSprintPointRollups(
  database: Database,
  projectId: string,
  sprintIds: string[],
): Promise<Map<string, { committed: number; done: number }>> {
  const map = new Map<string, { committed: number; done: number }>();
  for (const id of sprintIds) {
    map.set(id, { committed: 0, done: 0 });
  }
  if (sprintIds.length === 0) return map;

  const rows = await database.db
    .select({
      sprintId: projectTasks.sprintId,
      status: projectTasks.status,
      storyPoints: projectTasks.storyPoints,
    })
    .from(projectTasks)
    .where(
      and(
        eq(projectTasks.projectId, projectId),
        isNull(projectTasks.archivedAt),
        inArray(projectTasks.sprintId, sprintIds),
      ),
    );

  for (const row of rows) {
    if (!row.sprintId) continue;
    const points =
      typeof row.storyPoints === 'number' && row.storyPoints > 0
        ? row.storyPoints
        : 0;
    if (row.status === 'cancelled') continue;
    const bucket = map.get(row.sprintId) ?? { committed: 0, done: 0 };
    bucket.committed += points;
    if (row.status === 'done') {
      bucket.done += points;
    }
    map.set(row.sprintId, bucket);
  }
  return map;
}

export async function listSprints(
  database: Database,
  projectId: string,
  options?: { includeArchived?: boolean },
): Promise<PublicSprint[]> {
  const rows = await database.db
    .select()
    .from(projectSprints)
    .where(
      options?.includeArchived
        ? eq(projectSprints.projectId, projectId)
        : and(
            eq(projectSprints.projectId, projectId),
            isNull(projectSprints.archivedAt),
          ),
    )
    .orderBy(asc(projectSprints.sortOrder), asc(projectSprints.startDate));

  const keyPrefix = await getProjectKeyPrefix(database, projectId);
  const rollups = await loadSprintPointRollups(
    database,
    projectId,
    rows.map((row) => row.id),
  );
  return rows.map((row) => {
    const points = rollups.get(row.id);
    return toPublicSprint(row, {
      keyPrefix,
      committedPoints: points?.committed ?? 0,
      donePoints: points?.done ?? 0,
    });
  });
}

export async function getSprint(
  database: Database,
  sprintId: string,
): Promise<typeof projectSprints.$inferSelect> {
  const [row] = await database.db
    .select()
    .from(projectSprints)
    .where(eq(projectSprints.id, sprintId))
    .limit(1);
  if (!row) {
    throw new AppError({
      code: 'SPRINT_NOT_FOUND',
      message: 'Sprint not found',
      statusCode: 404,
    });
  }
  return row;
}

export async function getPublicSprint(
  database: Database,
  sprintId: string,
): Promise<PublicSprint> {
  const row = await getSprint(database, sprintId);
  const keyPrefix = await getProjectKeyPrefix(database, row.projectId);
  const rollups = await loadSprintPointRollups(database, row.projectId, [
    row.id,
  ]);
  const points = rollups.get(row.id);
  return toPublicSprint(row, {
    keyPrefix,
    committedPoints: points?.committed ?? 0,
    donePoints: points?.done ?? 0,
  });
}

export async function createSprint(
  database: Database,
  input: {
    projectId: string;
    name: string;
    goal?: string | null;
    status?: SprintStatus;
    startDate?: string | null;
    endDate?: string | null;
    capacityPoints?: number | null;
    sortOrder?: number;
  },
): Promise<PublicSprint> {
  const status = input.status ?? 'planned';
  if (status === 'active') {
    await assertNoOtherActiveSprint(database, input.projectId);
  }

  const allocated = await allocateIssueNumber(database, input.projectId, 'SP');
  const [row] = await database.db
    .insert(projectSprints)
    .values({
      projectId: input.projectId,
      name: input.name,
      goal: input.goal ?? null,
      status,
      startDate: input.startDate ?? null,
      endDate: input.endDate ?? null,
      capacityPoints: input.capacityPoints ?? null,
      sortOrder: input.sortOrder ?? 0,
      issueKeyType: allocated.issueKeyType,
      issueNumber: allocated.issueNumber,
    })
    .returning();
  if (!row) {
    throw new AppError({
      code: 'SPRINT_CREATE_FAILED',
      message: 'Failed to create sprint',
      statusCode: 500,
    });
  }
  return toPublicSprint(row, {
    keyPrefix: allocated.keyPrefix,
    committedPoints: 0,
    donePoints: 0,
  });
}

async function assertNoOtherActiveSprint(
  database: Database,
  projectId: string,
  excludeSprintId?: string,
): Promise<void> {
  const conditions = [
    eq(projectSprints.projectId, projectId),
    eq(projectSprints.status, 'active'),
    isNull(projectSprints.archivedAt),
  ];
  if (excludeSprintId) {
    conditions.push(ne(projectSprints.id, excludeSprintId));
  }
  const [existing] = await database.db
    .select({ id: projectSprints.id })
    .from(projectSprints)
    .where(and(...conditions))
    .limit(1);
  if (existing) {
    throw new AppError({
      code: 'SPRINT_ACTIVE_EXISTS',
      message: 'Project already has an active sprint',
      statusCode: 409,
    });
  }
}

export async function updateSprint(
  database: Database,
  sprintId: string,
  input: {
    name?: string;
    goal?: string | null;
    status?: SprintStatus;
    startDate?: string | null;
    endDate?: string | null;
    capacityPoints?: number | null;
    sortOrder?: number;
    archived?: boolean;
    /** On complete/cancel: move unfinished tasks to backlog or another sprint. */
    unfinishedDestination?: 'backlog' | { sprintId: string };
  },
): Promise<PublicSprint> {
  const existing = await getSprint(database, sprintId);
  const nextStatus = input.status ?? sprintStatusSchema.parse(existing.status);

  if (nextStatus === 'active' && existing.status !== 'active') {
    await assertNoOtherActiveSprint(database, existing.projectId, sprintId);
  }

  if (
    (nextStatus === 'completed' || nextStatus === 'cancelled') &&
    existing.status !== nextStatus
  ) {
    const dest = input.unfinishedDestination ?? 'backlog';
    if (dest === 'backlog') {
      await database.db
        .update(projectTasks)
        .set({ sprintId: null, updatedAt: new Date() })
        .where(
          and(
            eq(projectTasks.sprintId, sprintId),
            isNull(projectTasks.archivedAt),
            sql`${projectTasks.status} <> 'done'`,
            sql`${projectTasks.status} <> 'cancelled'`,
          ),
        );
    } else {
      const target = await getSprint(database, dest.sprintId);
      if (target.projectId !== existing.projectId) {
        throw new AppError({
          code: 'SPRINT_DESTINATION_INVALID',
          message: 'Destination sprint must belong to the same project',
          statusCode: 400,
        });
      }
      await database.db
        .update(projectTasks)
        .set({ sprintId: dest.sprintId, updatedAt: new Date() })
        .where(
          and(
            eq(projectTasks.sprintId, sprintId),
            isNull(projectTasks.archivedAt),
            sql`${projectTasks.status} <> 'done'`,
            sql`${projectTasks.status} <> 'cancelled'`,
          ),
        );
    }
  }

  const [row] = await database.db
    .update(projectSprints)
    .set({
      name: input.name ?? existing.name,
      goal: input.goal !== undefined ? input.goal : existing.goal,
      status: nextStatus,
      startDate:
        input.startDate !== undefined ? input.startDate : existing.startDate,
      endDate: input.endDate !== undefined ? input.endDate : existing.endDate,
      capacityPoints:
        input.capacityPoints !== undefined
          ? input.capacityPoints
          : existing.capacityPoints,
      sortOrder: input.sortOrder ?? existing.sortOrder,
      archivedAt:
        input.archived === undefined
          ? existing.archivedAt
          : input.archived
            ? existing.archivedAt ?? new Date()
            : null,
      updatedAt: new Date(),
    })
    .where(eq(projectSprints.id, sprintId))
    .returning();
  if (!row) {
    throw new AppError({
      code: 'SPRINT_UPDATE_FAILED',
      message: 'Failed to update sprint',
      statusCode: 500,
    });
  }
  return getPublicSprint(database, row.id);
}

export type SprintBurndownPoint = {
  date: string;
  idealRemaining: number;
  remaining: number;
};

function ymdUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDaysYmd(ymd: string, days: number): string {
  const ms = Date.parse(`${ymd}T00:00:00Z`) + days * 86_400_000;
  return ymdUtc(new Date(ms));
}

function daysBetweenInclusive(startYmd: string, endYmd: string): string[] {
  const out: string[] = [];
  let cursor = startYmd;
  let guard = 0;
  while (cursor <= endYmd && guard < 400) {
    out.push(cursor);
    cursor = addDaysYmd(cursor, 1);
    guard += 1;
  }
  return out;
}

/**
 * Point burndown for a sprint: ideal linear burn vs remaining points by day.
 * Remaining reconstructs from status_changed→done activities (and current status).
 */
export async function getSprintPointBurndown(
  database: Database,
  sprintId: string,
): Promise<{
  sprintId: string;
  startDate: string | null;
  endDate: string | null;
  committedPoints: number;
  points: SprintBurndownPoint[];
}> {
  const sprint = await getSprint(database, sprintId);
  const tasks = await database.db
    .select({
      id: projectTasks.id,
      status: projectTasks.status,
      storyPoints: projectTasks.storyPoints,
    })
    .from(projectTasks)
    .where(
      and(
        eq(projectTasks.sprintId, sprintId),
        isNull(projectTasks.archivedAt),
      ),
    );

  const scored = tasks.filter(
    (task) =>
      task.status !== 'cancelled' &&
      typeof task.storyPoints === 'number' &&
      task.storyPoints > 0,
  );
  const committedPoints = scored.reduce(
    (sum, task) => sum + (task.storyPoints ?? 0),
    0,
  );

  if (!sprint.startDate || !sprint.endDate || committedPoints <= 0) {
    return {
      sprintId,
      startDate: sprint.startDate,
      endDate: sprint.endDate,
      committedPoints,
      points: [],
    };
  }

  const taskIds = scored.map((task) => task.id);
  const doneOnByTask = new Map<string, string>();
  if (taskIds.length > 0) {
    const activities = await database.db
      .select({
        taskId: projectTaskActivities.taskId,
        type: projectTaskActivities.type,
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
      .orderBy(asc(projectTaskActivities.createdAt));

    for (const activity of activities) {
      const to =
        activity.metadataJson &&
        typeof activity.metadataJson === 'object' &&
        'to' in activity.metadataJson
          ? String((activity.metadataJson as { to?: unknown }).to)
          : null;
      if (to === 'done' && !doneOnByTask.has(activity.taskId)) {
        doneOnByTask.set(activity.taskId, ymdUtc(activity.createdAt));
      }
    }

    for (const task of scored) {
      if (task.status === 'done' && !doneOnByTask.has(task.id)) {
        // Done without activity trail — count as done from sprint start.
        doneOnByTask.set(task.id, sprint.startDate);
      }
    }
  }

  const today = ymdUtc(new Date());
  const seriesEnd = today < sprint.endDate ? today : sprint.endDate;
  const dates = daysBetweenInclusive(sprint.startDate, seriesEnd);
  const spanDays = Math.max(
    1,
    Math.round(
      (Date.parse(`${sprint.endDate}T00:00:00Z`) -
        Date.parse(`${sprint.startDate}T00:00:00Z`)) /
        86_400_000,
    ),
  );

  const points: SprintBurndownPoint[] = dates.map((date, index) => {
    const donePoints = scored.reduce((sum, task) => {
      const doneOn = doneOnByTask.get(task.id);
      if (doneOn && doneOn <= date) {
        return sum + (task.storyPoints ?? 0);
      }
      return sum;
    }, 0);
    const dayIndex = Math.min(index, spanDays);
    const idealRemaining = Math.max(
      0,
      committedPoints * (1 - dayIndex / spanDays),
    );
    return {
      date,
      idealRemaining: Math.round(idealRemaining * 100) / 100,
      remaining: Math.max(0, committedPoints - donePoints),
    };
  });

  return {
    sprintId,
    startDate: sprint.startDate,
    endDate: sprint.endDate,
    committedPoints,
    points,
  };
}
