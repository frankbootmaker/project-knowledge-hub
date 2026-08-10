import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { Database } from '@project-knowledge-hub/database';
import {
  memberships,
  projectRaidItems,
  projectRaidTaskLinks,
  projectTasks,
  users,
} from '@project-knowledge-hub/database';
import {
  AppError,
  raidKindSchema,
  raidSeveritySchema,
  raidStatusSchema,
  type RaidKind,
  type RaidSeverity,
  type RaidStatus,
} from '@project-knowledge-hub/domain';
import {
  assertProjectNotArchived,
  requireProjectContext,
} from './project-delivery.js';

export type PublicRaidTaskLink = {
  id: string;
  title: string;
  status: string;
};

export type PublicRaidOwner = {
  userId: string;
  displayName: string;
  email: string;
};

export type PublicRaidItem = {
  id: string;
  projectId: string;
  kind: RaidKind;
  title: string;
  description: string | null;
  status: RaidStatus;
  severity: RaidSeverity;
  ownerUserId: string | null;
  owner: PublicRaidOwner | null;
  dueDate: string | null;
  sortOrder: number;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  tasks: PublicRaidTaskLink[];
};

function toPublicRaidItem(
  row: typeof projectRaidItems.$inferSelect,
  tasks: PublicRaidTaskLink[],
  owner: PublicRaidOwner | null,
): PublicRaidItem {
  return {
    id: row.id,
    projectId: row.projectId,
    kind: raidKindSchema.parse(row.kind),
    title: row.title,
    description: row.description,
    status: raidStatusSchema.parse(row.status),
    severity: raidSeveritySchema.parse(row.severity),
    ownerUserId: row.ownerUserId,
    owner,
    dueDate: row.dueDate,
    sortOrder: row.sortOrder,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    tasks,
  };
}

async function assertWorkspaceMember(
  database: Database,
  workspaceId: string,
  userId: string,
): Promise<void> {
  const [row] = await database.db
    .select({ userId: memberships.userId })
    .from(memberships)
    .innerJoin(users, eq(memberships.userId, users.id))
    .where(
      and(
        eq(memberships.workspaceId, workspaceId),
        eq(memberships.userId, userId),
        eq(users.status, 'active'),
      ),
    )
    .limit(1);
  if (!row) {
    throw new AppError({
      code: 'RAID_OWNER_NOT_MEMBER',
      message: 'RAID owner must be an active workspace member',
      statusCode: 400,
    });
  }
}

async function loadOwners(
  database: Database,
  userIds: string[],
): Promise<Map<string, PublicRaidOwner>> {
  const map = new Map<string, PublicRaidOwner>();
  if (userIds.length === 0) return map;
  const rows = await database.db
    .select({
      id: users.id,
      displayName: users.displayName,
      email: users.email,
    })
    .from(users)
    .where(inArray(users.id, [...new Set(userIds)]));
  for (const row of rows) {
    map.set(row.id, {
      userId: row.id,
      displayName: row.displayName,
      email: row.email,
    });
  }
  return map;
}

async function loadTaskLinksByRaidIds(
  database: Database,
  raidIds: string[],
): Promise<Map<string, PublicRaidTaskLink[]>> {
  const map = new Map<string, PublicRaidTaskLink[]>();
  if (raidIds.length === 0) return map;
  const rows = await database.db
    .select({
      raidItemId: projectRaidTaskLinks.raidItemId,
      taskId: projectTasks.id,
      title: projectTasks.title,
      status: projectTasks.status,
    })
    .from(projectRaidTaskLinks)
    .innerJoin(projectTasks, eq(projectRaidTaskLinks.taskId, projectTasks.id))
    .where(inArray(projectRaidTaskLinks.raidItemId, raidIds))
    .orderBy(asc(projectTasks.title));
  for (const row of rows) {
    const list = map.get(row.raidItemId) ?? [];
    list.push({ id: row.taskId, title: row.title, status: row.status });
    map.set(row.raidItemId, list);
  }
  return map;
}

export async function listRaidItems(
  database: Database,
  projectId: string,
  options?: { includeArchived?: boolean },
): Promise<PublicRaidItem[]> {
  const conditions = [eq(projectRaidItems.projectId, projectId)];
  if (!options?.includeArchived) {
    conditions.push(isNull(projectRaidItems.archivedAt));
  }
  const rows = await database.db
    .select()
    .from(projectRaidItems)
    .where(and(...conditions))
    .orderBy(
      asc(projectRaidItems.sortOrder),
      asc(projectRaidItems.title),
    );
  const taskMap = await loadTaskLinksByRaidIds(
    database,
    rows.map((row) => row.id),
  );
  const ownerMap = await loadOwners(
    database,
    rows
      .map((row) => row.ownerUserId)
      .filter((id): id is string => Boolean(id)),
  );
  return rows.map((row) =>
    toPublicRaidItem(
      row,
      taskMap.get(row.id) ?? [],
      row.ownerUserId ? ownerMap.get(row.ownerUserId) ?? null : null,
    ),
  );
}

export async function getRaidItem(
  database: Database,
  raidItemId: string,
): Promise<PublicRaidItem> {
  const [row] = await database.db
    .select()
    .from(projectRaidItems)
    .where(eq(projectRaidItems.id, raidItemId))
    .limit(1);
  if (!row) {
    throw new AppError({
      code: 'RAID_ITEM_NOT_FOUND',
      message: 'RAID item not found',
      statusCode: 404,
    });
  }
  const taskMap = await loadTaskLinksByRaidIds(database, [row.id]);
  const ownerMap = await loadOwners(
    database,
    row.ownerUserId ? [row.ownerUserId] : [],
  );
  return toPublicRaidItem(
    row,
    taskMap.get(row.id) ?? [],
    row.ownerUserId ? ownerMap.get(row.ownerUserId) ?? null : null,
  );
}

export async function createRaidItem(
  database: Database,
  input: {
    projectId: string;
    workspaceId: string;
    kind: RaidKind;
    title: string;
    description?: string | null;
    status?: RaidStatus;
    severity?: RaidSeverity;
    ownerUserId?: string | null;
    dueDate?: string | null;
    sortOrder?: number;
    taskIds?: string[];
  },
): Promise<PublicRaidItem> {
  const { project } = await requireProjectContext(database, input.projectId);
  assertProjectNotArchived(project);
  if (input.ownerUserId) {
    await assertWorkspaceMember(database, input.workspaceId, input.ownerUserId);
  }

  const [created] = await database.db
    .insert(projectRaidItems)
    .values({
      projectId: input.projectId,
      kind: input.kind,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      status: input.status ?? 'open',
      severity: input.severity ?? 'medium',
      ownerUserId: input.ownerUserId ?? null,
      dueDate: input.dueDate ?? null,
      sortOrder: input.sortOrder ?? 0,
    })
    .returning();
  if (!created) {
    throw new AppError({
      code: 'RAID_CREATE_FAILED',
      message: 'Failed to create RAID item',
      statusCode: 500,
    });
  }

  if (input.taskIds && input.taskIds.length > 0) {
    await setRaidTaskLinks(database, {
      raidItemId: created.id,
      projectId: input.projectId,
      taskIds: input.taskIds,
    });
  }

  return getRaidItem(database, created.id);
}

export async function updateRaidItem(
  database: Database,
  raidItemId: string,
  input: {
    workspaceId: string;
    title?: string;
    description?: string | null;
    kind?: RaidKind;
    status?: RaidStatus;
    severity?: RaidSeverity;
    ownerUserId?: string | null;
    dueDate?: string | null;
    sortOrder?: number;
    archived?: boolean;
  },
): Promise<PublicRaidItem> {
  const existing = await getRaidItem(database, raidItemId);
  const { project } = await requireProjectContext(database, existing.projectId);
  assertProjectNotArchived(project);

  if (input.ownerUserId) {
    await assertWorkspaceMember(database, input.workspaceId, input.ownerUserId);
  }

  const patch: Partial<typeof projectRaidItems.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (input.title !== undefined) patch.title = input.title.trim();
  if (input.description !== undefined) {
    patch.description = input.description?.trim() || null;
  }
  if (input.kind !== undefined) patch.kind = input.kind;
  if (input.status !== undefined) patch.status = input.status;
  if (input.severity !== undefined) patch.severity = input.severity;
  if (input.ownerUserId !== undefined) patch.ownerUserId = input.ownerUserId;
  if (input.dueDate !== undefined) patch.dueDate = input.dueDate;
  if (input.sortOrder !== undefined) patch.sortOrder = input.sortOrder;
  if (input.archived === true) patch.archivedAt = new Date();
  if (input.archived === false) patch.archivedAt = null;

  await database.db
    .update(projectRaidItems)
    .set(patch)
    .where(eq(projectRaidItems.id, raidItemId));

  return getRaidItem(database, raidItemId);
}

export async function deleteRaidItem(
  database: Database,
  raidItemId: string,
): Promise<{ id: string; projectId: string }> {
  const existing = await getRaidItem(database, raidItemId);
  const { project } = await requireProjectContext(database, existing.projectId);
  assertProjectNotArchived(project);
  await database.db
    .delete(projectRaidItems)
    .where(eq(projectRaidItems.id, raidItemId));
  return { id: existing.id, projectId: existing.projectId };
}

export async function setRaidTaskLinks(
  database: Database,
  input: {
    raidItemId: string;
    projectId: string;
    taskIds: string[];
  },
): Promise<PublicRaidItem> {
  const uniqueTaskIds = [...new Set(input.taskIds)];
  if (uniqueTaskIds.length > 0) {
    const tasks = await database.db
      .select({ id: projectTasks.id, projectId: projectTasks.projectId })
      .from(projectTasks)
      .where(inArray(projectTasks.id, uniqueTaskIds));
    if (tasks.length !== uniqueTaskIds.length) {
      throw new AppError({
        code: 'RAID_TASK_NOT_FOUND',
        message: 'One or more linked tasks were not found',
        statusCode: 400,
      });
    }
    if (tasks.some((task) => task.projectId !== input.projectId)) {
      throw new AppError({
        code: 'RAID_TASK_PROJECT_MISMATCH',
        message: 'Linked tasks must belong to the same project as the RAID item',
        statusCode: 400,
      });
    }
  }

  await database.db
    .delete(projectRaidTaskLinks)
    .where(eq(projectRaidTaskLinks.raidItemId, input.raidItemId));

  if (uniqueTaskIds.length > 0) {
    await database.db.insert(projectRaidTaskLinks).values(
      uniqueTaskIds.map((taskId) => ({
        raidItemId: input.raidItemId,
        taskId,
      })),
    );
  }

  return getRaidItem(database, input.raidItemId);
}

export async function listRaidItemsForTask(
  database: Database,
  taskId: string,
): Promise<PublicRaidItem[]> {
  const links = await database.db
    .select({ raidItemId: projectRaidTaskLinks.raidItemId })
    .from(projectRaidTaskLinks)
    .where(eq(projectRaidTaskLinks.taskId, taskId));
  if (links.length === 0) return [];
  const items = await Promise.all(
    links.map((link) => getRaidItem(database, link.raidItemId)),
  );
  return items.filter((item) => !item.archivedAt);
}
