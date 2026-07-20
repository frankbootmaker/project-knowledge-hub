import type { FastifyInstance } from 'fastify';
import { and, desc, eq, isNull } from 'drizzle-orm';
import {
  conversationImportRecords,
  conversationImports,
  knowledgeRecords,
  workspaces,
} from '@project-knowledge-hub/database';
import { AppError } from '@project-knowledge-hub/domain';
import {
  createConversationImportInputSchema,
  createDraftFromImportInputSchema,
  normalizeRawContent,
  resolveDraftMarkdown,
  type CreateConversationImportInput,
  type CreateDraftFromImportInput,
} from '@project-knowledge-hub/conversation-import';
import { writeAuditEvent } from './identity.js';
import {
  assertProjectInWorkspace,
  assertSystemInWorkspace,
  createKnowledgeRecord,
  type KnowledgeActor,
} from './knowledge-records-service.js';

type ImportRow = typeof conversationImports.$inferSelect;

export function toPublicConversationImport(
  row: ImportRow,
  linkedRecords: Array<{
    knowledgeRecordId: string;
    title: string;
    slug: string;
    recordType: string;
    lifecycleStatus: string;
    excerptNote: string | null;
    createdAt: string;
  }> = [],
  options?: { includeRaw?: boolean },
) {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    systemId: row.systemId,
    title: row.title,
    contentFormat: row.contentFormat,
    rawContent: options?.includeRaw === false ? undefined : row.rawContent,
    sourceProvider: row.sourceProvider,
    generatedByModel: row.generatedByModel,
    createdBy: row.createdBy,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    linkedRecords,
  };
}

async function loadLinkedRecords(app: FastifyInstance, importId: string) {
  const rows = await app.database.db
    .select({
      knowledgeRecordId: conversationImportRecords.knowledgeRecordId,
      excerptNote: conversationImportRecords.excerptNote,
      linkCreatedAt: conversationImportRecords.createdAt,
      title: knowledgeRecords.title,
      slug: knowledgeRecords.slug,
      recordType: knowledgeRecords.recordType,
      lifecycleStatus: knowledgeRecords.lifecycleStatus,
    })
    .from(conversationImportRecords)
    .innerJoin(
      knowledgeRecords,
      eq(knowledgeRecords.id, conversationImportRecords.knowledgeRecordId),
    )
    .where(eq(conversationImportRecords.importId, importId))
    .orderBy(desc(conversationImportRecords.createdAt));

  return rows.map((row) => ({
    knowledgeRecordId: row.knowledgeRecordId,
    title: row.title,
    slug: row.slug,
    recordType: row.recordType,
    lifecycleStatus: row.lifecycleStatus,
    excerptNote: row.excerptNote,
    createdAt: row.linkCreatedAt.toISOString(),
  }));
}

export async function createConversationImport(
  app: FastifyInstance,
  input: CreateConversationImportInput,
  actor: KnowledgeActor,
  ipAddress?: string | null,
) {
  const body = createConversationImportInputSchema.parse(input);
  const rawContent = normalizeRawContent(body.rawContent);
  if (!rawContent) {
    throw new AppError({
      code: 'VALIDATION_ERROR',
      message: 'Import content is empty',
      statusCode: 400,
    });
  }

  const [workspace] = await app.database.db
    .select()
    .from(workspaces)
    .where(and(eq(workspaces.id, body.workspaceId), isNull(workspaces.archivedAt)))
    .limit(1);

  if (!workspace) {
    throw new AppError({
      code: 'WORKSPACE_NOT_FOUND',
      message: 'Workspace not found',
      statusCode: 404,
    });
  }

  await assertProjectInWorkspace(app.database, body.workspaceId, body.projectId);
  await assertSystemInWorkspace(app.database, body.workspaceId, body.systemId);

  const now = new Date();
  const [created] = await app.database.db
    .insert(conversationImports)
    .values({
      workspaceId: body.workspaceId,
      projectId: body.projectId ?? null,
      systemId: body.systemId ?? null,
      title: body.title.trim(),
      contentFormat: body.contentFormat,
      rawContent,
      sourceProvider: body.sourceProvider ?? null,
      generatedByModel: body.generatedByModel ?? null,
      createdBy: actor.userId,
      updatedAt: now,
    })
    .returning();

  if (!created) {
    throw new AppError({
      code: 'CONVERSATION_IMPORT_CREATE_FAILED',
      message: 'Failed to create conversation import',
      statusCode: 500,
    });
  }

  await writeAuditEvent(app.database, {
    organizationId: workspace.organizationId,
    actorType: actor.actorType,
    actorId: actor.actorId,
    action: 'conversation_import.create',
    entityType: 'conversation_import',
    entityId: created.id,
    metadata: {
      title: created.title,
      contentFormat: created.contentFormat,
      contentLength: created.rawContent.length,
    },
    ipAddress: ipAddress ?? null,
  });

  return toPublicConversationImport(created, []);
}

export async function listConversationImports(
  app: FastifyInstance,
  workspaceId: string,
  options?: { includeArchived?: boolean },
) {
  const rows = await app.database.db
    .select()
    .from(conversationImports)
    .where(
      options?.includeArchived
        ? eq(conversationImports.workspaceId, workspaceId)
        : and(
            eq(conversationImports.workspaceId, workspaceId),
            isNull(conversationImports.archivedAt),
          ),
    )
    .orderBy(desc(conversationImports.createdAt));

  return rows.map((row) => toPublicConversationImport(row, [], { includeRaw: false }));
}

export async function getConversationImport(app: FastifyInstance, importId: string) {
  const [row] = await app.database.db
    .select()
    .from(conversationImports)
    .where(eq(conversationImports.id, importId))
    .limit(1);

  if (!row) {
    throw new AppError({
      code: 'CONVERSATION_IMPORT_NOT_FOUND',
      message: 'Conversation import not found',
      statusCode: 404,
    });
  }

  const linked = await loadLinkedRecords(app, row.id);
  return toPublicConversationImport(row, linked);
}

export async function archiveConversationImport(
  app: FastifyInstance,
  importId: string,
  actor: KnowledgeActor,
  ipAddress?: string | null,
) {
  const [row] = await app.database.db
    .select()
    .from(conversationImports)
    .where(eq(conversationImports.id, importId))
    .limit(1);

  if (!row) {
    throw new AppError({
      code: 'CONVERSATION_IMPORT_NOT_FOUND',
      message: 'Conversation import not found',
      statusCode: 404,
    });
  }

  if (row.archivedAt) {
    const linked = await loadLinkedRecords(app, row.id);
    return toPublicConversationImport(row, linked);
  }

  const [workspace] = await app.database.db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, row.workspaceId))
    .limit(1);

  const now = new Date();
  const [updated] = await app.database.db
    .update(conversationImports)
    .set({ archivedAt: now, updatedAt: now })
    .where(eq(conversationImports.id, importId))
    .returning();

  if (!updated) {
    throw new AppError({
      code: 'CONVERSATION_IMPORT_ARCHIVE_FAILED',
      message: 'Failed to archive conversation import',
      statusCode: 500,
    });
  }

  await writeAuditEvent(app.database, {
    organizationId: workspace?.organizationId ?? null,
    actorType: actor.actorType,
    actorId: actor.actorId,
    action: 'conversation_import.archive',
    entityType: 'conversation_import',
    entityId: updated.id,
    ipAddress: ipAddress ?? null,
  });

  const linked = await loadLinkedRecords(app, updated.id);
  return toPublicConversationImport(updated, linked);
}

export async function createDraftFromConversationImport(
  app: FastifyInstance,
  importId: string,
  input: CreateDraftFromImportInput,
  actor: KnowledgeActor,
  ipAddress?: string | null,
) {
  const body = createDraftFromImportInputSchema.parse(input);

  const [row] = await app.database.db
    .select()
    .from(conversationImports)
    .where(eq(conversationImports.id, importId))
    .limit(1);

  if (!row) {
    throw new AppError({
      code: 'CONVERSATION_IMPORT_NOT_FOUND',
      message: 'Conversation import not found',
      statusCode: 404,
    });
  }

  if (row.archivedAt) {
    throw new AppError({
      code: 'CONVERSATION_IMPORT_ARCHIVED',
      message: 'Cannot create drafts from an archived import',
      statusCode: 400,
    });
  }

  let contentMarkdown: string;
  try {
    contentMarkdown = resolveDraftMarkdown({
      rawContent: row.rawContent,
      contentFormat: row.contentFormat as 'plain_text' | 'markdown',
      contentMarkdown: body.contentMarkdown,
    });
  } catch {
    throw new AppError({
      code: 'VALIDATION_ERROR',
      message: 'Draft content is empty',
      statusCode: 400,
    });
  }

  const projectId =
    body.projectId !== undefined ? body.projectId : row.projectId;
  const systemId = body.systemId !== undefined ? body.systemId : row.systemId;

  const { knowledgeRecord } = await createKnowledgeRecord(
    app,
    {
      workspaceId: row.workspaceId,
      title: body.title,
      slug: body.slug,
      summary: body.summary,
      recordType: body.recordType,
      lifecycleStatus: 'draft',
      sourceOfTruthMode: 'imported_snapshot',
      contentMarkdown,
      language: body.language,
      projectId,
      systemId,
      tags: body.tags,
      source: {
        sourceType: 'conversation',
        sourceProvider: row.sourceProvider ?? 'conversation-import',
        sourceReference: row.id,
        sourceTitle: row.title,
        generatedByModel: row.generatedByModel,
        metadata: {
          conversationImportId: row.id,
          contentFormat: row.contentFormat,
          excerpt: body.contentMarkdown !== undefined,
        },
      },
    },
    actor,
    ipAddress,
  );

  await app.database.db.insert(conversationImportRecords).values({
    importId: row.id,
    knowledgeRecordId: knowledgeRecord.id,
    excerptNote: body.excerptNote ?? null,
  });

  const [workspace] = await app.database.db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, row.workspaceId))
    .limit(1);

  await writeAuditEvent(app.database, {
    organizationId: workspace?.organizationId ?? null,
    actorType: actor.actorType,
    actorId: actor.actorId,
    action: 'conversation_import.create_record',
    entityType: 'conversation_import',
    entityId: row.id,
    metadata: {
      knowledgeRecordId: knowledgeRecord.id,
      slug: knowledgeRecord.slug,
      recordType: knowledgeRecord.recordType,
    },
    ipAddress: ipAddress ?? null,
  });

  const linked = await loadLinkedRecords(app, row.id);
  return {
    conversationImport: toPublicConversationImport(row, linked),
    knowledgeRecord,
  };
}
