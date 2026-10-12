import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { Database } from '@project-knowledge-hub/database';
import {
  knowledgeRecords,
  memberships,
  projectRaidItems,
  projectRaidRecordLinks,
  projectRaidTaskLinks,
  projectTasks,
  projects,
  users,
} from '@project-knowledge-hub/database';
import {
  AppError,
  formatHumanKey,
  raidKindSchema,
  raidKindToIssueKeyType,
  raidSeveritySchema,
  raidStatusSchema,
  type RaidKind,
  type RaidSeverity,
  type RaidStatus,
} from '@project-knowledge-hub/domain';
import { diffReplacement } from './replace-diff.js';
import { activeMemberConditions } from './user-category.js';
import {
  assertProjectNotArchived,
  requireProjectContext,
} from './project-delivery.js';
import {
  allocateIssueNumber,
  getProjectKeyPrefix,
  toHumanKeyFields,
} from './project-issue-keys.js';

export type PublicRaidTaskLink = {
  id: string;
  title: string;
  status: string;
  humanKey: string | null;
};

export type PublicRaidRecordLink = {
  id: string;
  title: string;
  slug: string;
  recordType: string;
  humanKey: string | null;
};

export type PublicRecordRaidLink = {
  id: string;
  title: string;
  kind: RaidKind;
  severity: RaidSeverity;
  humanKey: string | null;
  projectSlug: string;
};

export type PublicRaidOwner = {
  userId: string;
  displayName: string;
  email: string;
  userType: string;
};

export type PublicRaidItem = {
  id: string;
  projectId: string;
  kind: RaidKind;
  title: string;
  description: string | null;
  status: RaidStatus;
  severity: RaidSeverity;
  probability: RaidSeverity | null;
  impact: RaidSeverity | null;
  ownerUserId: string | null;
  owner: PublicRaidOwner | null;
  dueDate: string | null;
  sortOrder: number;
  issueKeyType: string | null;
  issueNumber: number | null;
  humanKey: string | null;
  transferredToRaidItemId: string | null;
  transferredFromRaidItemId: string | null;
  transferredToHumanKey: string | null;
  transferredFromHumanKey: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  tasks: PublicRaidTaskLink[];
  records: PublicRaidRecordLink[];
};

function storedRating(value: string | null): RaidSeverity | null {
  if (!value) return null;
  return raidSeveritySchema.parse(value);
}

function toPublicRaidItem(
  row: typeof projectRaidItems.$inferSelect,
  tasks: PublicRaidTaskLink[],
  records: PublicRaidRecordLink[],
  owner: PublicRaidOwner | null,
  keyPrefix: string | null,
  transferKeys?: {
    transferredToHumanKey?: string | null;
    transferredFromHumanKey?: string | null;
  },
): PublicRaidItem {
  const keys = toHumanKeyFields(keyPrefix, row.issueKeyType, row.issueNumber);
  return {
    id: row.id,
    projectId: row.projectId,
    kind: raidKindSchema.parse(row.kind),
    title: row.title,
    description: row.description,
    status: raidStatusSchema.parse(row.status),
    severity: raidSeveritySchema.parse(row.severity),
    probability: storedRating(row.probability),
    impact: storedRating(row.impact),
    ownerUserId: row.ownerUserId,
    owner,
    dueDate: row.dueDate,
    sortOrder: row.sortOrder,
    issueKeyType: keys.issueKeyType,
    issueNumber: keys.issueNumber,
    humanKey: keys.humanKey,
    transferredToRaidItemId: row.transferredToRaidItemId,
    transferredFromRaidItemId: row.transferredFromRaidItemId,
    transferredToHumanKey: transferKeys?.transferredToHumanKey ?? null,
    transferredFromHumanKey: transferKeys?.transferredFromHumanKey ?? null,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    tasks,
    records,
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
        ...activeMemberConditions(),
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
      userType: users.userType,
    })
    .from(users)
    .where(inArray(users.id, [...new Set(userIds)]));
  for (const row of rows) {
    map.set(row.id, {
      userId: row.id,
      displayName: row.displayName,
      email: row.email,
      userType: row.userType,
    });
  }
  return map;
}

async function loadTaskLinksByRaidIds(
  database: Database,
  raidIds: string[],
  keyPrefix: string | null,
): Promise<Map<string, PublicRaidTaskLink[]>> {
  const map = new Map<string, PublicRaidTaskLink[]>();
  if (raidIds.length === 0) return map;
  const rows = await database.db
    .select({
      raidItemId: projectRaidTaskLinks.raidItemId,
      taskId: projectTasks.id,
      title: projectTasks.title,
      status: projectTasks.status,
      issueKeyType: projectTasks.issueKeyType,
      issueNumber: projectTasks.issueNumber,
    })
    .from(projectRaidTaskLinks)
    .innerJoin(projectTasks, eq(projectRaidTaskLinks.taskId, projectTasks.id))
    .where(inArray(projectRaidTaskLinks.raidItemId, raidIds))
    .orderBy(asc(projectTasks.title));
  for (const row of rows) {
    const list = map.get(row.raidItemId) ?? [];
    list.push({
      id: row.taskId,
      title: row.title,
      status: row.status,
      humanKey: formatHumanKey(keyPrefix, row.issueKeyType, row.issueNumber),
    });
    map.set(row.raidItemId, list);
  }
  return map;
}

async function loadRecordLinksByRaidIds(
  database: Database,
  raidIds: string[],
  keyPrefix: string | null,
): Promise<Map<string, PublicRaidRecordLink[]>> {
  const map = new Map<string, PublicRaidRecordLink[]>();
  if (raidIds.length === 0) return map;
  const rows = await database.db
    .select({
      raidItemId: projectRaidRecordLinks.raidItemId,
      recordId: knowledgeRecords.id,
      title: knowledgeRecords.title,
      slug: knowledgeRecords.slug,
      recordType: knowledgeRecords.recordType,
      documentKeyType: knowledgeRecords.documentKeyType,
      documentNumber: knowledgeRecords.documentNumber,
    })
    .from(projectRaidRecordLinks)
    .innerJoin(
      knowledgeRecords,
      eq(projectRaidRecordLinks.knowledgeRecordId, knowledgeRecords.id),
    )
    .where(inArray(projectRaidRecordLinks.raidItemId, raidIds))
    .orderBy(asc(knowledgeRecords.title));
  for (const row of rows) {
    const list = map.get(row.raidItemId) ?? [];
    list.push({
      id: row.recordId,
      title: row.title,
      slug: row.slug,
      recordType: row.recordType,
      humanKey: formatHumanKey(keyPrefix, row.documentKeyType, row.documentNumber),
    });
    map.set(row.raidItemId, list);
  }
  return map;
}

async function loadTransferHumanKeys(
  database: Database,
  rows: Array<typeof projectRaidItems.$inferSelect>,
  keyPrefix: string | null,
): Promise<Map<string, { to: string | null; from: string | null }>> {
  const ids = [
    ...new Set(
      rows.flatMap((row) =>
        [row.transferredToRaidItemId, row.transferredFromRaidItemId].filter(
          (id): id is string => Boolean(id),
        ),
      ),
    ),
  ];
  const keyById = new Map<string, string | null>();
  if (ids.length > 0) {
    const related = await database.db
      .select({
        id: projectRaidItems.id,
        issueKeyType: projectRaidItems.issueKeyType,
        issueNumber: projectRaidItems.issueNumber,
      })
      .from(projectRaidItems)
      .where(inArray(projectRaidItems.id, ids));
    for (const row of related) {
      keyById.set(
        row.id,
        formatHumanKey(keyPrefix, row.issueKeyType, row.issueNumber),
      );
    }
  }
  const map = new Map<string, { to: string | null; from: string | null }>();
  for (const row of rows) {
    map.set(row.id, {
      to: row.transferredToRaidItemId
        ? keyById.get(row.transferredToRaidItemId) ?? null
        : null,
      from: row.transferredFromRaidItemId
        ? keyById.get(row.transferredFromRaidItemId) ?? null
        : null,
    });
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
  const keyPrefix = await getProjectKeyPrefix(database, projectId);
  const taskMap = await loadTaskLinksByRaidIds(
    database,
    rows.map((row) => row.id),
    keyPrefix,
  );
  const recordMap = await loadRecordLinksByRaidIds(
    database,
    rows.map((row) => row.id),
    keyPrefix,
  );
  const ownerMap = await loadOwners(
    database,
    rows
      .map((row) => row.ownerUserId)
      .filter((id): id is string => Boolean(id)),
  );
  const transferMap = await loadTransferHumanKeys(database, rows, keyPrefix);
  return rows.map((row) =>
    toPublicRaidItem(
      row,
      taskMap.get(row.id) ?? [],
      recordMap.get(row.id) ?? [],
      row.ownerUserId ? ownerMap.get(row.ownerUserId) ?? null : null,
      keyPrefix,
      {
        transferredToHumanKey: transferMap.get(row.id)?.to ?? null,
        transferredFromHumanKey: transferMap.get(row.id)?.from ?? null,
      },
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
  const keyPrefix = await getProjectKeyPrefix(database, row.projectId);
  const taskMap = await loadTaskLinksByRaidIds(database, [row.id], keyPrefix);
  const recordMap = await loadRecordLinksByRaidIds(database, [row.id], keyPrefix);
  const ownerMap = await loadOwners(
    database,
    row.ownerUserId ? [row.ownerUserId] : [],
  );
  const transferMap = await loadTransferHumanKeys(database, [row], keyPrefix);
  return toPublicRaidItem(
    row,
    taskMap.get(row.id) ?? [],
    recordMap.get(row.id) ?? [],
    row.ownerUserId ? ownerMap.get(row.ownerUserId) ?? null : null,
    keyPrefix,
    {
      transferredToHumanKey: transferMap.get(row.id)?.to ?? null,
      transferredFromHumanKey: transferMap.get(row.id)?.from ?? null,
    },
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
    probability?: RaidSeverity | null;
    impact?: RaidSeverity | null;
    ownerUserId?: string | null;
    dueDate?: string | null;
    sortOrder?: number;
    taskIds?: string[];
    recordIds?: string[];
    createdBy?: string | null;
  },
): Promise<PublicRaidItem> {
  const { project } = await requireProjectContext(database, input.projectId);
  assertProjectNotArchived(project);
  if (input.ownerUserId) {
    await assertWorkspaceMember(database, input.workspaceId, input.ownerUserId);
  }

  const created = await database.db.transaction(async (tx) => {
    const allocated = await allocateIssueNumber(
      database,
      input.projectId,
      raidKindToIssueKeyType(input.kind),
      tx,
    );

    const [row] = await tx
      .insert(projectRaidItems)
      .values({
        projectId: input.projectId,
        kind: input.kind,
        title: input.title.trim(),
        description: input.description?.trim() || null,
        status: input.status ?? 'open',
        severity: input.severity ?? 'medium',
        probability: input.probability ?? null,
        impact: input.impact ?? null,
        ownerUserId: input.ownerUserId ?? null,
        dueDate: input.dueDate ?? null,
        sortOrder: input.sortOrder ?? 0,
        issueKeyType: allocated.issueKeyType,
        issueNumber: allocated.issueNumber,
        createdBy: input.createdBy ?? null,
      })
      .returning();
    if (!row) {
      throw new AppError({
        code: 'RAID_CREATE_FAILED',
        message: 'Failed to create RAID item',
        statusCode: 500,
      });
    }
    return row;
  });

  if (input.taskIds && input.taskIds.length > 0) {
    await setRaidTaskLinks(database, {
      raidItemId: created.id,
      projectId: input.projectId,
      taskIds: input.taskIds,
      createdBy: input.createdBy,
    });
  }
  if (input.recordIds && input.recordIds.length > 0) {
    await setRaidRecordLinks(database, {
      raidItemId: created.id,
      projectId: input.projectId,
      recordIds: input.recordIds,
      createdBy: input.createdBy,
    });
  }

  return getRaidItem(database, created.id);
}

function isRiskIssueKind(kind: RaidKind): kind is 'risk' | 'issue' {
  return kind === 'risk' || kind === 'issue';
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
    probability?: RaidSeverity | null;
    impact?: RaidSeverity | null;
    ownerUserId?: string | null;
    dueDate?: string | null;
    sortOrder?: number;
    archived?: boolean;
  },
): Promise<PublicRaidItem> {
  const existing = await getRaidItem(database, raidItemId);
  const { project } = await requireProjectContext(database, existing.projectId);
  assertProjectNotArchived(project);

  if (input.kind !== undefined && input.kind !== existing.kind) {
    const riskIssueSwap =
      isRiskIssueKind(existing.kind) &&
      isRiskIssueKind(input.kind) &&
      existing.kind !== input.kind;
    if (riskIssueSwap) {
      throw new AppError({
        code: 'RAID_KIND_USE_TRANSFER',
        message:
          'Cannot change RAID kind between risk and issue in place; use transfer instead',
        statusCode: 400,
      });
    }
  }

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
  if (input.probability !== undefined) patch.probability = input.probability;
  if (input.impact !== undefined) patch.impact = input.impact;
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

export async function transferRaidItem(
  database: Database,
  raidItemId: string,
  targetKind: 'risk' | 'issue',
  createdBy?: string | null,
): Promise<{ source: PublicRaidItem; target: PublicRaidItem }> {
  const source = await getRaidItem(database, raidItemId);
  const { project } = await requireProjectContext(database, source.projectId);
  assertProjectNotArchived(project);

  if (!isRiskIssueKind(source.kind)) {
    throw new AppError({
      code: 'RAID_TRANSFER_UNSUPPORTED',
      message: 'Only risks and issues can be transferred',
      statusCode: 400,
    });
  }
  if (source.kind === targetKind) {
    throw new AppError({
      code: 'RAID_TRANSFER_SAME_KIND',
      message: `RAID item is already a ${targetKind}`,
      statusCode: 400,
    });
  }
  if (source.archivedAt) {
    throw new AppError({
      code: 'RAID_TRANSFER_ARCHIVED',
      message: 'Cannot transfer an archived RAID item',
      statusCode: 400,
    });
  }
  if (source.transferredToRaidItemId) {
    throw new AppError({
      code: 'RAID_TRANSFER_ALREADY',
      message: 'RAID item has already been transferred',
      statusCode: 409,
    });
  }

  const created = await database.db.transaction(async (tx) => {
    const allocated = await allocateIssueNumber(
      database,
      source.projectId,
      raidKindToIssueKeyType(targetKind),
      tx,
    );

    const [row] = await tx
      .insert(projectRaidItems)
      .values({
        projectId: source.projectId,
        kind: targetKind,
        title: source.title,
        description: source.description,
        status: source.status,
        severity: source.severity,
        probability: source.probability,
        impact: source.impact,
        ownerUserId: source.ownerUserId,
        dueDate: source.dueDate,
        sortOrder: source.sortOrder,
        issueKeyType: allocated.issueKeyType,
        issueNumber: allocated.issueNumber,
        transferredFromRaidItemId: source.id,
        createdBy: createdBy ?? null,
      })
      .returning();
    if (!row) {
      throw new AppError({
        code: 'RAID_TRANSFER_FAILED',
        message: 'Failed to create transfer target RAID item',
        statusCode: 500,
      });
    }
    return row;
  });

  const taskIds = source.tasks.map((task) => task.id);
  if (taskIds.length > 0) {
    await setRaidTaskLinks(database, {
      raidItemId: created.id,
      projectId: source.projectId,
      taskIds,
      createdBy,
    });
  }

  const recordIds = source.records.map((record) => record.id);
  if (recordIds.length > 0) {
    await setRaidRecordLinks(database, {
      raidItemId: created.id,
      projectId: source.projectId,
      recordIds,
      createdBy,
    });
  }

  await database.db
    .update(projectRaidItems)
    .set({
      transferredToRaidItemId: created.id,
      archivedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(projectRaidItems.id, source.id));

  const [nextSource, nextTarget] = await Promise.all([
    getRaidItem(database, source.id),
    getRaidItem(database, created.id),
  ]);
  return { source: nextSource, target: nextTarget };
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
    createdBy?: string | null;
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

  await database.db.transaction(async (tx) => {
    const db = tx as unknown as Database['db'];
    const existing = await db
      .select({
        id: projectRaidTaskLinks.id,
        taskId: projectRaidTaskLinks.taskId,
      })
      .from(projectRaidTaskLinks)
      .where(eq(projectRaidTaskLinks.raidItemId, input.raidItemId));
    const diff = diffReplacement(
      existing,
      uniqueTaskIds.map((taskId) => ({ taskId })),
      (row) => row.taskId,
      (row) => row.taskId,
      () => true,
    );
    if (diff.remove.length > 0) {
      await db
        .delete(projectRaidTaskLinks)
        .where(
          inArray(
            projectRaidTaskLinks.id,
            diff.remove.map((row) => row.id),
          ),
        );
    }
    if (diff.insert.length > 0) {
      await db.insert(projectRaidTaskLinks).values(
        diff.insert.map((row) => ({
          raidItemId: input.raidItemId,
          taskId: row.taskId,
          createdBy: input.createdBy ?? null,
        })),
      );
    }
  });

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

export async function setRaidRecordLinks(
  database: Database,
  input: {
    raidItemId: string;
    projectId: string;
    recordIds: string[];
    createdBy?: string | null;
  },
): Promise<PublicRaidItem> {
  const uniqueRecordIds = [...new Set(input.recordIds)];
  if (uniqueRecordIds.length > 0) {
    const records = await database.db
      .select({
        id: knowledgeRecords.id,
        projectId: knowledgeRecords.projectId,
      })
      .from(knowledgeRecords)
      .where(inArray(knowledgeRecords.id, uniqueRecordIds));
    if (records.length !== uniqueRecordIds.length) {
      throw new AppError({
        code: 'RAID_RECORD_NOT_FOUND',
        message: 'One or more linked knowledge records were not found',
        statusCode: 400,
      });
    }
    if (records.some((record) => record.projectId !== input.projectId)) {
      throw new AppError({
        code: 'RAID_RECORD_PROJECT_MISMATCH',
        message: 'Linked records must belong to the same project as the RAID item',
        statusCode: 400,
      });
    }
  }

  await database.db.transaction(async (tx) => {
    const db = tx as unknown as Database['db'];
    const existing = await db
      .select({
        id: projectRaidRecordLinks.id,
        knowledgeRecordId: projectRaidRecordLinks.knowledgeRecordId,
      })
      .from(projectRaidRecordLinks)
      .where(eq(projectRaidRecordLinks.raidItemId, input.raidItemId));
    const diff = diffReplacement(
      existing,
      uniqueRecordIds.map((knowledgeRecordId) => ({ knowledgeRecordId })),
      (row) => row.knowledgeRecordId,
      (row) => row.knowledgeRecordId,
      () => true,
    );
    if (diff.remove.length > 0) {
      await db
        .delete(projectRaidRecordLinks)
        .where(
          inArray(
            projectRaidRecordLinks.id,
            diff.remove.map((row) => row.id),
          ),
        );
    }
    if (diff.insert.length > 0) {
      await db.insert(projectRaidRecordLinks).values(
        diff.insert.map((row) => ({
          raidItemId: input.raidItemId,
          knowledgeRecordId: row.knowledgeRecordId,
          createdBy: input.createdBy ?? null,
        })),
      );
    }
  });

  return getRaidItem(database, input.raidItemId);
}

export async function listRaidItemsForRecord(
  database: Database,
  recordId: string,
): Promise<PublicRecordRaidLink[]> {
  const rows = await database.db
    .select({
      id: projectRaidItems.id,
      title: projectRaidItems.title,
      kind: projectRaidItems.kind,
      severity: projectRaidItems.severity,
      issueKeyType: projectRaidItems.issueKeyType,
      issueNumber: projectRaidItems.issueNumber,
      keyPrefix: projects.keyPrefix,
      projectSlug: projects.slug,
    })
    .from(projectRaidRecordLinks)
    .innerJoin(
      projectRaidItems,
      eq(projectRaidRecordLinks.raidItemId, projectRaidItems.id),
    )
    .innerJoin(projects, eq(projectRaidItems.projectId, projects.id))
    .where(
      and(
        eq(projectRaidRecordLinks.knowledgeRecordId, recordId),
        isNull(projectRaidItems.archivedAt),
      ),
    )
    .orderBy(asc(projectRaidItems.title));
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    kind: raidKindSchema.parse(row.kind),
    severity: raidSeveritySchema.parse(row.severity),
    humanKey: formatHumanKey(row.keyPrefix, row.issueKeyType, row.issueNumber),
    projectSlug: row.projectSlug,
  }));
}

export async function setRecordRaidLinks(
  database: Database,
  input: {
    recordId: string;
    raidItemIds: string[];
    createdBy?: string | null;
  },
): Promise<PublicRecordRaidLink[]> {
  const [record] = await database.db
    .select({
      id: knowledgeRecords.id,
      projectId: knowledgeRecords.projectId,
    })
    .from(knowledgeRecords)
    .where(eq(knowledgeRecords.id, input.recordId))
    .limit(1);
  if (!record) {
    throw new AppError({
      code: 'KNOWLEDGE_RECORD_NOT_FOUND',
      message: 'Knowledge record not found',
      statusCode: 404,
    });
  }
  if (!record.projectId) {
    throw new AppError({
      code: 'RAID_RECORD_PROJECT_MISMATCH',
      message: 'Linked records must belong to the same project as the RAID item',
      statusCode: 400,
    });
  }

  const uniqueRaidIds = [...new Set(input.raidItemIds)];
  if (uniqueRaidIds.length > 0) {
    const items = await database.db
      .select({
        id: projectRaidItems.id,
        projectId: projectRaidItems.projectId,
      })
      .from(projectRaidItems)
      .where(inArray(projectRaidItems.id, uniqueRaidIds));
    if (items.length !== uniqueRaidIds.length) {
      throw new AppError({
        code: 'RAID_ITEM_NOT_FOUND',
        message: 'One or more RAID items were not found',
        statusCode: 400,
      });
    }
    if (items.some((item) => item.projectId !== record.projectId)) {
      throw new AppError({
        code: 'RAID_RECORD_PROJECT_MISMATCH',
        message: 'Linked records must belong to the same project as the RAID item',
        statusCode: 400,
      });
    }
  }

  await database.db.transaction(async (tx) => {
    const db = tx as unknown as Database['db'];
    const existing = await db
      .select({
        id: projectRaidRecordLinks.id,
        raidItemId: projectRaidRecordLinks.raidItemId,
      })
      .from(projectRaidRecordLinks)
      .where(eq(projectRaidRecordLinks.knowledgeRecordId, input.recordId));
    const diff = diffReplacement(
      existing,
      uniqueRaidIds.map((raidItemId) => ({ raidItemId })),
      (row) => row.raidItemId,
      (row) => row.raidItemId,
      () => true,
    );
    if (diff.remove.length > 0) {
      await db
        .delete(projectRaidRecordLinks)
        .where(
          inArray(
            projectRaidRecordLinks.id,
            diff.remove.map((row) => row.id),
          ),
        );
    }
    if (diff.insert.length > 0) {
      await db.insert(projectRaidRecordLinks).values(
        diff.insert.map((row) => ({
          raidItemId: row.raidItemId,
          knowledgeRecordId: input.recordId,
          createdBy: input.createdBy ?? null,
        })),
      );
    }
  });

  return listRaidItemsForRecord(database, input.recordId);
}
