import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { Database } from '@project-knowledge-hub/database';
import {
  knowledgeRecords,
  memberships,
  projectChangeDeliveryLinks,
  projectChangeItems,
  projectEpics,
  projectMilestones,
  projectTasks,
  projectUserStories,
  users,
} from '@project-knowledge-hub/database';
import {
  AppError,
  changeDeliveryEntityTypeSchema,
  changeKindSchema,
  changeStatusSchema,
  type ChangeDeliveryEntityType,
  type ChangeKind,
  type ChangeStatus,
} from '@project-knowledge-hub/domain';
import {
  assertProjectNotArchived,
  requireProjectContext,
} from './project-delivery.js';

export type PublicChangeDeliveryLink = {
  entityType: ChangeDeliveryEntityType;
  entityId: string;
  entityTitle: string | null;
};

export type PublicChangePerson = {
  userId: string;
  displayName: string;
  email: string;
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
  knowledgeRecordId: string | null;
  knowledgeRecordTitle: string | null;
  sortOrder: number;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  deliveryLinks: PublicChangeDeliveryLink[];
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
        eq(users.status, 'active'),
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

function toPublicChangeItem(
  row: typeof projectChangeItems.$inferSelect,
  links: PublicChangeDeliveryLink[],
  people: Map<string, PublicChangePerson>,
  knowledgeTitle: string | null,
): PublicChangeItem {
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
    knowledgeRecordId: row.knowledgeRecordId,
    knowledgeRecordTitle: knowledgeTitle,
    sortOrder: row.sortOrder,
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

  const linkMap = await loadDeliveryLinks(
    database,
    rows.map((row) => row.id),
  );
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

  return rows.map((row) =>
    toPublicChangeItem(
      row,
      linkMap.get(row.id) ?? [],
      people,
      row.knowledgeRecordId
        ? knowledgeTitles.get(row.knowledgeRecordId) ?? null
        : null,
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
  return found;
}

export async function setChangeDeliveryLinks(
  database: Database,
  input: {
    changeId: string;
    projectId: string;
    links: Array<{ entityType: ChangeDeliveryEntityType; entityId: string }>;
  },
): Promise<void> {
  const unique = new Map<string, { entityType: ChangeDeliveryEntityType; entityId: string }>();
  for (const link of input.links) {
    unique.set(`${link.entityType}:${link.entityId}`, link);
  }
  const links = [...unique.values()];
  for (const link of links) {
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
    if (entity.projectId !== input.projectId) {
      throw new AppError({
        code: 'CHANGE_LINK_PROJECT_MISMATCH',
        message: 'Change delivery links must target entities in the same project',
        statusCode: 400,
      });
    }
  }

  await database.db
    .delete(projectChangeDeliveryLinks)
    .where(eq(projectChangeDeliveryLinks.changeId, input.changeId));
  if (links.length > 0) {
    await database.db.insert(projectChangeDeliveryLinks).values(
      links.map((link) => ({
        changeId: input.changeId,
        entityType: link.entityType,
        entityId: link.entityId,
      })),
    );
  }
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
    sortOrder?: number;
    deliveryLinks?: Array<{
      entityType: ChangeDeliveryEntityType;
      entityId: string;
    }>;
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
  if (input.knowledgeRecordId) {
    const [record] = await database.db
      .select({ projectId: knowledgeRecords.projectId })
      .from(knowledgeRecords)
      .where(eq(knowledgeRecords.id, input.knowledgeRecordId))
      .limit(1);
    if (!record || record.projectId !== input.projectId) {
      throw new AppError({
        code: 'CHANGE_KNOWLEDGE_PROJECT_MISMATCH',
        message: 'Linked knowledge record must belong to this project',
        statusCode: 400,
      });
    }
  }

  const status = input.status ?? 'proposed';
  const [created] = await database.db
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
      knowledgeRecordId: input.knowledgeRecordId ?? null,
      sortOrder: input.sortOrder ?? 0,
    })
    .returning();
  if (!created) {
    throw new AppError({
      code: 'CHANGE_CREATE_FAILED',
      message: 'Failed to create change item',
      statusCode: 500,
    });
  }

  if (input.deliveryLinks && input.deliveryLinks.length > 0) {
    await setChangeDeliveryLinks(database, {
      changeId: created.id,
      projectId: input.projectId,
      links: input.deliveryLinks,
    });
  }

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
    sortOrder?: number;
    archived?: boolean;
    deliveryLinks?: Array<{
      entityType: ChangeDeliveryEntityType;
      entityId: string;
    }>;
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
  if (input.knowledgeRecordId !== undefined) {
    patch.knowledgeRecordId = input.knowledgeRecordId;
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

  if (input.deliveryLinks) {
    await setChangeDeliveryLinks(database, {
      changeId,
      projectId: existing.projectId,
      links: input.deliveryLinks,
    });
  }

  return getChangeItem(database, changeId);
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
