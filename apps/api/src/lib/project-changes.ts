import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { Database } from '@project-knowledge-hub/database';
import {
  knowledgeRecords,
  memberships,
  projectChangeDeliveryLinks,
  projectChangeItems,
  projectChangeRecordLinks,
  projectEpics,
  projectMilestones,
  projectTasks,
  projectUserStories,
  projects,
  users,
} from '@project-knowledge-hub/database';
import {
  AppError,
  assertDateRange,
  changeDeliveryEntityTypeSchema,
  changeKindSchema,
  changeStatusSchema,
  formatHumanKey,
  type ChangeDeliveryEntityType,
  type ChangeKind,
  type ChangeStatus,
} from '@project-knowledge-hub/domain';
import type { PublicItemMediaLink } from './project-item-media.js';
import { withMediaLinkCounts, withMediaLinks } from './project-item-media.js';
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

export type PublicChangeDeliveryLink = {
  entityType: ChangeDeliveryEntityType;
  entityId: string;
  entityTitle: string | null;
};

export type PublicChangeRecordLink = {
  id: string;
  title: string;
  slug: string;
  recordType: string | null;
  humanKey: string | null;
};

export type PublicChangePerson = {
  userId: string;
  displayName: string;
  email: string;
  userType: string;
};

export type PublicChangeItem = {
  id: string;
  projectId: string;
  kind: ChangeKind;
  title: string;
  description: string | null;
  rationale: string | null;
  status: ChangeStatus;
  requestedByUserId: string | null;
  requestedBy: PublicChangePerson | null;
  approvedByUserId: string | null;
  approvedBy: PublicChangePerson | null;
  requestedAt: string;
  decidedAt: string | null;
  effectiveDate: string | null;
  baselineStartBefore: string | null;
  baselineStartAfter: string | null;
  baselineEndBefore: string | null;
  baselineEndAfter: string | null;
  baselineAppliedAt: string | null;
  knowledgeRecordId: string | null;
  knowledgeRecordTitle: string | null;
  records: PublicChangeRecordLink[];
  sortOrder: number;
  issueKeyType: string | null;
  issueNumber: number | null;
  humanKey: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  deliveryLinks: PublicChangeDeliveryLink[];
  mediaLinkCount?: number;
  mediaLinks?: PublicItemMediaLink[];
};

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
      code: 'CHANGE_USER_NOT_MEMBER',
      message: 'User must be an active workspace member',
      statusCode: 400,
    });
  }
}

async function loadPeople(
  database: Database,
  userIds: string[],
): Promise<Map<string, PublicChangePerson>> {
  const map = new Map<string, PublicChangePerson>();
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

async function resolveEntityTitle(
  database: Database,
  entityType: ChangeDeliveryEntityType,
  entityId: string,
): Promise<{ projectId: string; title: string } | null> {
  if (entityType === 'epic') {
    const [row] = await database.db
      .select({ projectId: projectEpics.projectId, title: projectEpics.title })
      .from(projectEpics)
      .where(eq(projectEpics.id, entityId))
      .limit(1);
    return row ?? null;
  }
  if (entityType === 'user_story') {
    const [row] = await database.db
      .select({
        projectId: projectUserStories.projectId,
        title: projectUserStories.title,
      })
      .from(projectUserStories)
      .where(eq(projectUserStories.id, entityId))
      .limit(1);
    return row ?? null;
  }
  if (entityType === 'milestone') {
    const [row] = await database.db
      .select({
        projectId: projectMilestones.projectId,
        title: projectMilestones.title,
      })
      .from(projectMilestones)
      .where(eq(projectMilestones.id, entityId))
      .limit(1);
    return row ?? null;
  }
  const [row] = await database.db
    .select({ projectId: projectTasks.projectId, title: projectTasks.title })
    .from(projectTasks)
    .where(eq(projectTasks.id, entityId))
    .limit(1);
  return row ?? null;
}

async function loadDeliveryLinks(
  database: Database,
  changeIds: string[],
): Promise<Map<string, PublicChangeDeliveryLink[]>> {
  const map = new Map<string, PublicChangeDeliveryLink[]>();
  if (changeIds.length === 0) return map;
  const rows = await database.db
    .select()
    .from(projectChangeDeliveryLinks)
    .where(inArray(projectChangeDeliveryLinks.changeId, changeIds));
  for (const row of rows) {
    const entityType = changeDeliveryEntityTypeSchema.parse(row.entityType);
    const entity = await resolveEntityTitle(database, entityType, row.entityId);
    const list = map.get(row.changeId) ?? [];
    list.push({
      entityType,
      entityId: row.entityId,
      entityTitle: entity?.title ?? null,
    });
    map.set(row.changeId, list);
  }
  return map;
}

async function loadRecordLinksByChangeIds(
  database: Database,
  changeIds: string[],
  keyPrefix: string | null,
): Promise<Map<string, PublicChangeRecordLink[]>> {
  const map = new Map<string, PublicChangeRecordLink[]>();
  if (changeIds.length === 0) return map;
  const rows = await database.db
    .select({
      changeId: projectChangeRecordLinks.changeId,
      recordId: knowledgeRecords.id,
      title: knowledgeRecords.title,
      slug: knowledgeRecords.slug,
      recordType: knowledgeRecords.recordType,
      documentKeyType: knowledgeRecords.documentKeyType,
      documentNumber: knowledgeRecords.documentNumber,
    })
    .from(projectChangeRecordLinks)
    .innerJoin(
      knowledgeRecords,
      eq(projectChangeRecordLinks.knowledgeRecordId, knowledgeRecords.id),
    )
    .where(inArray(projectChangeRecordLinks.changeId, changeIds))
    .orderBy(asc(knowledgeRecords.title));
  for (const row of rows) {
    const list = map.get(row.changeId) ?? [];
    list.push({
      id: row.recordId,
      title: row.title,
      slug: row.slug,
      recordType: row.recordType,
      humanKey: formatHumanKey(keyPrefix, row.documentKeyType, row.documentNumber),
    });
    map.set(row.changeId, list);
  }
  return map;
}

function linkedRecordIds(input: {
  recordIds?: string[];
  knowledgeRecordId?: string | null;
}): string[] | undefined {
  if (input.recordIds !== undefined) return [...new Set(input.recordIds)];
  if (input.knowledgeRecordId !== undefined) {
    return input.knowledgeRecordId ? [input.knowledgeRecordId] : [];
  }
  return undefined;
}

function toPublicChangeItem(
  row: typeof projectChangeItems.$inferSelect,
  links: PublicChangeDeliveryLink[],
  records: PublicChangeRecordLink[],
  people: Map<string, PublicChangePerson>,
  knowledgeTitle: string | null,
  keyPrefix?: string | null,
): PublicChangeItem {
  const keys = toHumanKeyFields(keyPrefix, row.issueKeyType, row.issueNumber);
  return {
    id: row.id,
    projectId: row.projectId,
    kind: changeKindSchema.parse(row.kind),
    title: row.title,
    description: row.description,
    rationale: row.rationale,
    status: changeStatusSchema.parse(row.status),
    requestedByUserId: row.requestedByUserId,
    requestedBy: row.requestedByUserId
      ? people.get(row.requestedByUserId) ?? null
      : null,
    approvedByUserId: row.approvedByUserId,
    approvedBy: row.approvedByUserId
      ? people.get(row.approvedByUserId) ?? null
      : null,
    requestedAt: row.requestedAt.toISOString(),
    decidedAt: row.decidedAt?.toISOString() ?? null,
    effectiveDate: row.effectiveDate,
    baselineStartBefore: row.baselineStartBefore,
    baselineStartAfter: row.baselineStartAfter,
    baselineEndBefore: row.baselineEndBefore,
    baselineEndAfter: row.baselineEndAfter,
    baselineAppliedAt: row.baselineAppliedAt?.toISOString() ?? null,
    knowledgeRecordId: row.knowledgeRecordId,
    knowledgeRecordTitle: knowledgeTitle,
    records,
    sortOrder: row.sortOrder,
    issueKeyType: keys.issueKeyType,
    issueNumber: keys.issueNumber,
    humanKey: keys.humanKey,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deliveryLinks: links,
  };
}

export async function listChangeItems(
  database: Database,
  projectId: string,
  options?: { includeArchived?: boolean },
): Promise<PublicChangeItem[]> {
  const conditions = [eq(projectChangeItems.projectId, projectId)];
  if (!options?.includeArchived) {
    conditions.push(isNull(projectChangeItems.archivedAt));
  }
  const rows = await database.db
    .select()
    .from(projectChangeItems)
    .where(and(...conditions))
    .orderBy(asc(projectChangeItems.sortOrder), asc(projectChangeItems.title));

  const changeIds = rows.map((row) => row.id);
  const keyPrefix = await getProjectKeyPrefix(database, projectId);
  const linkMap = await loadDeliveryLinks(database, changeIds);
  const recordMap = await loadRecordLinksByChangeIds(database, changeIds, keyPrefix);
  const people = await loadPeople(
    database,
    rows.flatMap((row) =>
      [row.requestedByUserId, row.approvedByUserId].filter(
        (id): id is string => Boolean(id),
      ),
    ),
  );
  const knowledgeIds = rows
    .map((row) => row.knowledgeRecordId)
    .filter((id): id is string => Boolean(id));
  const knowledgeTitles = new Map<string, string>();
  if (knowledgeIds.length > 0) {
    const knowledgeRows = await database.db
      .select({ id: knowledgeRecords.id, title: knowledgeRecords.title })
      .from(knowledgeRecords)
      .where(inArray(knowledgeRecords.id, knowledgeIds));
    for (const row of knowledgeRows) {
      knowledgeTitles.set(row.id, row.title);
    }
  }

  return withMediaLinkCounts(
    database,
    'change',
    rows.map((row) =>
      toPublicChangeItem(
        row,
        linkMap.get(row.id) ?? [],
        recordMap.get(row.id) ?? [],
        people,
        row.knowledgeRecordId
          ? knowledgeTitles.get(row.knowledgeRecordId) ?? null
          : null,
        keyPrefix,
      ),
    ),
  );
}

export async function getChangeItem(
  database: Database,
  changeId: string,
): Promise<PublicChangeItem> {
  const [row] = await database.db
    .select()
    .from(projectChangeItems)
    .where(eq(projectChangeItems.id, changeId))
    .limit(1);
  if (!row) {
    throw new AppError({
      code: 'CHANGE_ITEM_NOT_FOUND',
      message: 'Change item not found',
      statusCode: 404,
    });
  }
  const items = await listChangeItems(database, row.projectId, {
    includeArchived: true,
  });
  const found = items.find((item) => item.id === changeId);
  if (!found) {
    throw new AppError({
      code: 'CHANGE_ITEM_NOT_FOUND',
      message: 'Change item not found',
      statusCode: 404,
    });
  }
  return withMediaLinks(database, 'change', found);
}

async function assertChangeDeliveryTargets(
  database: Database,
  projectId: string,
  links: Array<{ entityType: ChangeDeliveryEntityType; entityId: string }>,
): Promise<Array<{ entityType: ChangeDeliveryEntityType; entityId: string }>> {
  const unique = new Map<string, { entityType: ChangeDeliveryEntityType; entityId: string }>();
  for (const link of links) {
    unique.set(`${link.entityType}:${link.entityId}`, link);
  }
  const normalized = [...unique.values()];
  for (const link of normalized) {
    const entity = await resolveEntityTitle(
      database,
      link.entityType,
      link.entityId,
    );
    if (!entity) {
      throw new AppError({
        code: 'CHANGE_LINK_ENTITY_NOT_FOUND',
        message: `Delivery entity not found: ${link.entityType}:${link.entityId}`,
        statusCode: 400,
      });
    }
    if (entity.projectId !== projectId) {
      throw new AppError({
        code: 'CHANGE_LINK_PROJECT_MISMATCH',
        message: 'Change delivery links must target entities in the same project',
        statusCode: 400,
      });
    }
  }
  return normalized;
}

export async function setChangeDeliveryLinks(
  database: Database,
  input: {
    changeId: string;
    projectId: string;
    links: Array<{ entityType: ChangeDeliveryEntityType; entityId: string }>;
    createdBy?: string | null;
  },
): Promise<void> {
  const links = await assertChangeDeliveryTargets(
    database,
    input.projectId,
    input.links,
  );

  await database.db.transaction(async (tx) => {
    const db = tx as unknown as Database['db'];
    const existing = await db
      .select({
        id: projectChangeDeliveryLinks.id,
        entityType: projectChangeDeliveryLinks.entityType,
        entityId: projectChangeDeliveryLinks.entityId,
      })
      .from(projectChangeDeliveryLinks)
      .where(eq(projectChangeDeliveryLinks.changeId, input.changeId));
    const diff = diffReplacement(
      existing,
      links,
      (row) => `${row.entityType}:${row.entityId}`,
      (row) => `${row.entityType}:${row.entityId}`,
      () => true,
    );
    if (diff.remove.length > 0) {
      await db
        .delete(projectChangeDeliveryLinks)
        .where(
          inArray(
            projectChangeDeliveryLinks.id,
            diff.remove.map((row) => row.id),
          ),
        );
    }
    if (diff.insert.length > 0) {
      await db.insert(projectChangeDeliveryLinks).values(
        diff.insert.map((link) => ({
          changeId: input.changeId,
          entityType: link.entityType,
          entityId: link.entityId,
          createdBy: input.createdBy ?? null,
        })),
      );
    }
  });
}

async function assertChangeRecordsInProject(
  database: Database,
  projectId: string,
  recordIds: string[],
): Promise<void> {
  if (recordIds.length === 0) return;
  const { project } = await requireProjectContext(database, projectId);
  const rows = await database.db
    .select({
      id: knowledgeRecords.id,
      projectId: knowledgeRecords.projectId,
      workspaceId: knowledgeRecords.workspaceId,
    })
    .from(knowledgeRecords)
    .where(inArray(knowledgeRecords.id, recordIds));
  const found = new Map(rows.map((row) => [row.id, row]));
  for (const recordId of recordIds) {
    const row = found.get(recordId);
    if (!row) {
      throw new AppError({
        code: 'CHANGE_KNOWLEDGE_NOT_FOUND',
        message: 'Linked knowledge record was not found',
        statusCode: 400,
      });
    }
    if (row.projectId !== projectId || row.workspaceId !== project.workspaceId) {
      throw new AppError({
        code: 'CHANGE_KNOWLEDGE_PROJECT_MISMATCH',
        message: 'Linked knowledge record must belong to this project',
        statusCode: 400,
      });
    }
  }
}

export async function setChangeRecordLinks(
  database: Database,
  input: {
    changeId: string;
    projectId: string;
    recordIds: string[];
    createdBy?: string | null;
  },
): Promise<void> {
  const recordIds = [...new Set(input.recordIds)];
  await assertChangeRecordsInProject(database, input.projectId, recordIds);

  await database.db.transaction(async (tx) => {
    const db = tx as unknown as Database['db'];
    const existing = await db
      .select({
        id: projectChangeRecordLinks.id,
        knowledgeRecordId: projectChangeRecordLinks.knowledgeRecordId,
      })
      .from(projectChangeRecordLinks)
      .where(eq(projectChangeRecordLinks.changeId, input.changeId));
    const next = recordIds.map((knowledgeRecordId) => ({ knowledgeRecordId }));
    const diff = diffReplacement(
      existing,
      next,
      (row) => row.knowledgeRecordId,
      (row) => row.knowledgeRecordId,
      () => true,
    );
    if (diff.remove.length > 0) {
      await db
        .delete(projectChangeRecordLinks)
        .where(
          inArray(
            projectChangeRecordLinks.id,
            diff.remove.map((row) => row.id),
          ),
        );
    }
    if (diff.insert.length > 0) {
      await db.insert(projectChangeRecordLinks).values(
        diff.insert.map((link) => ({
          changeId: input.changeId,
          knowledgeRecordId: link.knowledgeRecordId,
          createdBy: input.createdBy ?? null,
        })),
      );
    }
  });
}

export async function createChangeItem(
  database: Database,
  input: {
    projectId: string;
    workspaceId: string;
    kind: ChangeKind;
    title: string;
    description?: string | null;
    rationale?: string | null;
    status?: ChangeStatus;
    requestedByUserId?: string | null;
    approvedByUserId?: string | null;
    effectiveDate?: string | null;
    baselineStartBefore?: string | null;
    baselineStartAfter?: string | null;
    baselineEndBefore?: string | null;
    baselineEndAfter?: string | null;
    knowledgeRecordId?: string | null;
    recordIds?: string[];
    sortOrder?: number;
    deliveryLinks?: Array<{
      entityType: ChangeDeliveryEntityType;
      entityId: string;
    }>;
    createdBy?: string | null;
  },
): Promise<PublicChangeItem> {
  const { project } = await requireProjectContext(database, input.projectId);
  assertProjectNotArchived(project);
  if (input.requestedByUserId) {
    await assertWorkspaceMember(
      database,
      input.workspaceId,
      input.requestedByUserId,
    );
  }
  if (input.approvedByUserId) {
    await assertWorkspaceMember(
      database,
      input.workspaceId,
      input.approvedByUserId,
    );
  }
  const recordIds = linkedRecordIds(input);
  if (recordIds && recordIds.length > 0) {
    await assertChangeRecordsInProject(database, input.projectId, recordIds);
  }
  const deliveryLinks =
    input.deliveryLinks && input.deliveryLinks.length > 0
      ? await assertChangeDeliveryTargets(
          database,
          input.projectId,
          input.deliveryLinks,
        )
      : [];
  const status = input.status ?? 'proposed';
  // recordIds replaces the linked set. The first id is also stored as
  // knowledgeRecordId (the legacy single-document column).
  const primaryRecordId = recordIds?.[0] ?? null;

  const created = await database.db.transaction(async (tx) => {
    const allocated = await allocateIssueNumber(database, input.projectId, 'C', tx);
    const [row] = await tx
      .insert(projectChangeItems)
      .values({
        projectId: input.projectId,
        kind: input.kind,
        title: input.title.trim(),
        description: input.description?.trim() || null,
        rationale: input.rationale?.trim() || null,
        status,
        requestedByUserId: input.requestedByUserId ?? null,
        approvedByUserId: input.approvedByUserId ?? null,
        decidedAt:
          status === 'approved' || status === 'rejected' || status === 'implemented'
            ? new Date()
            : null,
        effectiveDate: input.effectiveDate ?? null,
        baselineStartBefore: input.baselineStartBefore ?? null,
        baselineStartAfter: input.baselineStartAfter ?? null,
        baselineEndBefore: input.baselineEndBefore ?? null,
        baselineEndAfter: input.baselineEndAfter ?? null,
        knowledgeRecordId: primaryRecordId,
        sortOrder: input.sortOrder ?? 0,
        issueKeyType: allocated.issueKeyType,
        issueNumber: allocated.issueNumber,
        createdBy: input.createdBy ?? null,
      })
      .returning();
    if (!row) {
      throw new AppError({
        code: 'CHANGE_CREATE_FAILED',
        message: 'Failed to create change item',
        statusCode: 500,
      });
    }
    if (recordIds && recordIds.length > 0) {
      await tx.insert(projectChangeRecordLinks).values(
        recordIds.map((knowledgeRecordId) => ({
          changeId: row.id,
          knowledgeRecordId,
          createdBy: input.createdBy ?? null,
        })),
      );
    }
    if (deliveryLinks.length > 0) {
      await tx.insert(projectChangeDeliveryLinks).values(
        deliveryLinks.map((link) => ({
          changeId: row.id,
          entityType: link.entityType,
          entityId: link.entityId,
          createdBy: input.createdBy ?? null,
        })),
      );
    }
    return row;
  });

  return getChangeItem(database, created.id);
}

export async function updateChangeItem(
  database: Database,
  changeId: string,
  input: {
    workspaceId: string;
    kind?: ChangeKind;
    title?: string;
    description?: string | null;
    rationale?: string | null;
    status?: ChangeStatus;
    requestedByUserId?: string | null;
    approvedByUserId?: string | null;
    effectiveDate?: string | null;
    baselineStartBefore?: string | null;
    baselineStartAfter?: string | null;
    baselineEndBefore?: string | null;
    baselineEndAfter?: string | null;
    knowledgeRecordId?: string | null;
    recordIds?: string[];
    sortOrder?: number;
    archived?: boolean;
    deliveryLinks?: Array<{
      entityType: ChangeDeliveryEntityType;
      entityId: string;
    }>;
    createdBy?: string | null;
  },
): Promise<PublicChangeItem> {
  const existing = await getChangeItem(database, changeId);
  const { project } = await requireProjectContext(database, existing.projectId);
  assertProjectNotArchived(project);

  if (input.requestedByUserId) {
    await assertWorkspaceMember(
      database,
      input.workspaceId,
      input.requestedByUserId,
    );
  }
  if (input.approvedByUserId) {
    await assertWorkspaceMember(
      database,
      input.workspaceId,
      input.approvedByUserId,
    );
  }

  const recordIds = linkedRecordIds(input);
  if (recordIds !== undefined) {
    await assertChangeRecordsInProject(database, existing.projectId, recordIds);
  }
  const nextStatus = input.status ?? existing.status;
  const patch: Partial<typeof projectChangeItems.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (input.kind !== undefined) patch.kind = input.kind;
  if (input.title !== undefined) patch.title = input.title.trim();
  if (input.description !== undefined) {
    patch.description = input.description?.trim() || null;
  }
  if (input.rationale !== undefined) {
    patch.rationale = input.rationale?.trim() || null;
  }
  if (input.status !== undefined) patch.status = input.status;
  if (input.requestedByUserId !== undefined) {
    patch.requestedByUserId = input.requestedByUserId;
  }
  if (input.approvedByUserId !== undefined) {
    patch.approvedByUserId = input.approvedByUserId;
  }
  if (input.effectiveDate !== undefined) {
    patch.effectiveDate = input.effectiveDate;
  }
  if (input.baselineStartBefore !== undefined) {
    patch.baselineStartBefore = input.baselineStartBefore;
  }
  if (input.baselineStartAfter !== undefined) {
    patch.baselineStartAfter = input.baselineStartAfter;
  }
  if (input.baselineEndBefore !== undefined) {
    patch.baselineEndBefore = input.baselineEndBefore;
  }
  if (input.baselineEndAfter !== undefined) {
    patch.baselineEndAfter = input.baselineEndAfter;
  }
  if (recordIds !== undefined) {
    patch.knowledgeRecordId = recordIds[0] ?? null;
  }
  if (input.sortOrder !== undefined) patch.sortOrder = input.sortOrder;
  if (input.archived === true) patch.archivedAt = new Date();
  if (input.archived === false) patch.archivedAt = null;

  if (
    input.status !== undefined &&
    input.status !== existing.status &&
    (nextStatus === 'approved' ||
      nextStatus === 'rejected' ||
      nextStatus === 'implemented')
  ) {
    patch.decidedAt = new Date();
  }

  await database.db
    .update(projectChangeItems)
    .set(patch)
    .where(eq(projectChangeItems.id, changeId));

  if (recordIds !== undefined) {
    await setChangeRecordLinks(database, {
      changeId,
      projectId: existing.projectId,
      recordIds,
      createdBy: input.createdBy,
    });
  }

  if (input.deliveryLinks) {
    await setChangeDeliveryLinks(database, {
      changeId,
      projectId: existing.projectId,
      links: input.deliveryLinks,
      createdBy: input.createdBy,
    });
  }

  return getChangeItem(database, changeId);
}

/** True when the change stores a baseline start or finish to write onto the project. */
export function changeHasScheduleChange(item: {
  baselineStartAfter: string | null;
  baselineEndAfter: string | null;
}): boolean {
  return item.baselineStartAfter != null || item.baselineEndAfter != null;
}

/**
 * Write an approved change's schedule onto the project baseline.
 * Sets the project end (and start, when present), marks the change
 * implemented, and records baselineAppliedAt. A second call is a no-op.
 */
export async function applyChangeToBaseline(
  database: Database,
  changeId: string,
): Promise<{ changeItem: PublicChangeItem; applied: boolean }> {
  const existing = await getChangeItem(database, changeId);
  if (existing.baselineAppliedAt) {
    return { changeItem: existing, applied: false };
  }
  if (existing.archivedAt) {
    throw new AppError({
      code: 'CHANGE_ARCHIVED',
      message: 'Archived change requests cannot be applied to the baseline',
      statusCode: 409,
    });
  }
  if (existing.status !== 'approved') {
    throw new AppError({
      code: 'CHANGE_NOT_APPROVED',
      message: 'Only an approved change request can be applied to the baseline',
      statusCode: 409,
    });
  }
  if (!changeHasScheduleChange(existing)) {
    throw new AppError({
      code: 'CHANGE_NO_SCHEDULE',
      message: 'This change request has no baseline start or finish to apply',
      statusCode: 409,
    });
  }

  const { project } = await requireProjectContext(database, existing.projectId);
  assertProjectNotArchived(project);
  const nextStart = existing.baselineStartAfter ?? project.startDate;
  const nextEnd = existing.baselineEndAfter ?? project.endDate;
  assertDateRange({
    start: nextStart,
    end: nextEnd,
    startField: 'startDate',
    endField: 'endDate',
  });

  let applied = false;
  await database.db.transaction(async (tx) => {
    const [locked] = await tx
      .update(projectChangeItems)
      .set({
        status: 'implemented',
        baselineAppliedAt: new Date(),
        decidedAt: existing.decidedAt ? new Date(existing.decidedAt) : new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(projectChangeItems.id, changeId),
          isNull(projectChangeItems.baselineAppliedAt),
        ),
      )
      .returning({ id: projectChangeItems.id });
    if (!locked) return;
    await tx
      .update(projects)
      .set({
        startDate: nextStart,
        endDate: nextEnd,
        updatedAt: new Date(),
      })
      .where(eq(projects.id, project.id));
    applied = true;
  });

  return {
    changeItem: await getChangeItem(database, changeId),
    applied,
  };
}

export async function deleteChangeItem(
  database: Database,
  changeId: string,
): Promise<{ id: string; projectId: string }> {
  const existing = await getChangeItem(database, changeId);
  const { project } = await requireProjectContext(database, existing.projectId);
  assertProjectNotArchived(project);
  await database.db
    .delete(projectChangeItems)
    .where(eq(projectChangeItems.id, changeId));
  return { id: existing.id, projectId: existing.projectId };
}
