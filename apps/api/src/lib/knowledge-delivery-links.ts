import { and, eq, inArray } from 'drizzle-orm';
import type { Database } from '@project-knowledge-hub/database';
import {
  knowledgeRecordDeliveryLinks,
  knowledgeRecords,
  projectEpics,
  projectSprints,
  projectTasks,
  projectUserStories,
} from '@project-knowledge-hub/database';
import {
  AppError,
  deliveryLinkEntityTypeSchema,
  type DeliveryLinkEntityType,
} from '@project-knowledge-hub/domain';

export type PublicDeliveryLink = {
  id: string;
  knowledgeRecordId: string;
  entityType: DeliveryLinkEntityType;
  entityId: string;
  entityTitle: string | null;
  createdAt: string;
};

export type PublicDeliveryDocumentLink = {
  knowledgeRecordId: string;
  title: string;
  recordType: string;
  slug: string;
  entityType: DeliveryLinkEntityType;
  entityId: string;
};

async function resolveEntityTitle(
  database: Database,
  entityType: DeliveryLinkEntityType,
  entityId: string,
): Promise<{ projectId: string; title: string } | null> {
  if (entityType === 'epic') {
    const [row] = await database.db
      .select({
        projectId: projectEpics.projectId,
        title: projectEpics.title,
      })
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
  if (entityType === 'sprint') {
    const [row] = await database.db
      .select({
        projectId: projectSprints.projectId,
        title: projectSprints.name,
      })
      .from(projectSprints)
      .where(eq(projectSprints.id, entityId))
      .limit(1);
    return row ?? null;
  }
  const [row] = await database.db
    .select({
      projectId: projectTasks.projectId,
      title: projectTasks.title,
    })
    .from(projectTasks)
    .where(eq(projectTasks.id, entityId))
    .limit(1);
  return row ?? null;
}

async function assertEntitiesBelongToProject(
  database: Database,
  projectId: string,
  links: Array<{ entityType: DeliveryLinkEntityType; entityId: string }>,
): Promise<void> {
  for (const link of links) {
    const entity = await resolveEntityTitle(
      database,
      link.entityType,
      link.entityId,
    );
    if (!entity) {
      throw new AppError({
        code: 'DELIVERY_LINK_ENTITY_NOT_FOUND',
        message: `Delivery entity not found: ${link.entityType}:${link.entityId}`,
        statusCode: 400,
      });
    }
    if (entity.projectId !== projectId) {
      throw new AppError({
        code: 'DELIVERY_LINK_PROJECT_MISMATCH',
        message: 'Delivery links must target entities in the record’s project',
        statusCode: 400,
      });
    }
  }
}

export async function getKnowledgeRecordProjectContext(
  database: Database,
  recordId: string,
): Promise<{
  id: string;
  workspaceId: string;
  projectId: string | null;
  title: string;
  slug: string;
  recordType: string;
}> {
  const [row] = await database.db
    .select({
      id: knowledgeRecords.id,
      workspaceId: knowledgeRecords.workspaceId,
      projectId: knowledgeRecords.projectId,
      title: knowledgeRecords.title,
      slug: knowledgeRecords.slug,
      recordType: knowledgeRecords.recordType,
    })
    .from(knowledgeRecords)
    .where(eq(knowledgeRecords.id, recordId))
    .limit(1);
  if (!row) {
    throw new AppError({
      code: 'KNOWLEDGE_RECORD_NOT_FOUND',
      message: 'Knowledge record not found',
      statusCode: 404,
    });
  }
  return row;
}

export async function listDeliveryLinksForRecord(
  database: Database,
  knowledgeRecordId: string,
): Promise<PublicDeliveryLink[]> {
  const rows = await database.db
    .select()
    .from(knowledgeRecordDeliveryLinks)
    .where(eq(knowledgeRecordDeliveryLinks.knowledgeRecordId, knowledgeRecordId));

  const result: PublicDeliveryLink[] = [];
  for (const row of rows) {
    const entityType = deliveryLinkEntityTypeSchema.parse(row.entityType);
    const entity = await resolveEntityTitle(database, entityType, row.entityId);
    result.push({
      id: row.id,
      knowledgeRecordId: row.knowledgeRecordId,
      entityType,
      entityId: row.entityId,
      entityTitle: entity?.title ?? null,
      createdAt: row.createdAt.toISOString(),
    });
  }
  return result;
}

export async function setDeliveryLinksForRecord(
  database: Database,
  input: {
    knowledgeRecordId: string;
    links: Array<{ entityType: DeliveryLinkEntityType; entityId: string }>;
  },
): Promise<PublicDeliveryLink[]> {
  const record = await getKnowledgeRecordProjectContext(
    database,
    input.knowledgeRecordId,
  );
  if (!record.projectId) {
    throw new AppError({
      code: 'DELIVERY_LINK_REQUIRES_PROJECT',
      message: 'Delivery links require the knowledge record to be linked to a project',
      statusCode: 400,
    });
  }

  const unique = new Map<string, { entityType: DeliveryLinkEntityType; entityId: string }>();
  for (const link of input.links) {
    unique.set(`${link.entityType}:${link.entityId}`, link);
  }
  const links = [...unique.values()];
  await assertEntitiesBelongToProject(database, record.projectId, links);

  await database.db
    .delete(knowledgeRecordDeliveryLinks)
    .where(
      eq(
        knowledgeRecordDeliveryLinks.knowledgeRecordId,
        input.knowledgeRecordId,
      ),
    );

  if (links.length > 0) {
    await database.db.insert(knowledgeRecordDeliveryLinks).values(
      links.map((link) => ({
        knowledgeRecordId: input.knowledgeRecordId,
        entityType: link.entityType,
        entityId: link.entityId,
      })),
    );
  }

  return listDeliveryLinksForRecord(database, input.knowledgeRecordId);
}

export async function listDeliveryDocumentLinksForProject(
  database: Database,
  projectId: string,
  filter?: { entityType?: DeliveryLinkEntityType; entityId?: string },
): Promise<PublicDeliveryDocumentLink[]> {
  const projectRecords = await database.db
    .select({
      id: knowledgeRecords.id,
      title: knowledgeRecords.title,
      recordType: knowledgeRecords.recordType,
      slug: knowledgeRecords.slug,
    })
    .from(knowledgeRecords)
    .where(eq(knowledgeRecords.projectId, projectId));

  if (projectRecords.length === 0) return [];
  const recordById = new Map(projectRecords.map((row) => [row.id, row]));
  const recordIds = projectRecords.map((row) => row.id);

  const conditions = [
    inArray(knowledgeRecordDeliveryLinks.knowledgeRecordId, recordIds),
  ];
  if (filter?.entityType) {
    conditions.push(
      eq(knowledgeRecordDeliveryLinks.entityType, filter.entityType),
    );
  }
  if (filter?.entityId) {
    conditions.push(eq(knowledgeRecordDeliveryLinks.entityId, filter.entityId));
  }

  const links = await database.db
    .select()
    .from(knowledgeRecordDeliveryLinks)
    .where(and(...conditions));

  return links.map((link) => {
    const record = recordById.get(link.knowledgeRecordId)!;
    return {
      knowledgeRecordId: link.knowledgeRecordId,
      title: record.title,
      recordType: record.recordType,
      slug: record.slug,
      entityType: deliveryLinkEntityTypeSchema.parse(link.entityType),
      entityId: link.entityId,
    };
  });
}
