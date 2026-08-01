import type { FastifyInstance } from 'fastify';
import { and, eq, isNull } from 'drizzle-orm';
import { slugify } from '@project-knowledge-hub/auth';
import {
  knowledgeRecords,
  knowledgeSources,
  projects,
  systems,
  users,
  workspaces,
  type Database,
} from '@project-knowledge-hub/database';
import {
  AppError,
  knowledgeSourceTypeSchema,
  lifecycleStatusSchema,
  recordTypeSchema,
  sourceOfTruthModeSchema,
} from '@project-knowledge-hub/domain';
import { renderMarkdown } from '@project-knowledge-hub/markdown';
import { z } from 'zod';
import {
  contentFieldsChanged,
  ensureBaselineVersion,
  insertVersionSnapshot,
  supersedeOtherCurrentInSeries,
} from './knowledge-versions.js';
import { getKnowledgeRecordTags, setKnowledgeRecordTags } from './tags.js';
import { writeAuditEvent } from './identity.js';

export const sourceInputSchema = z.object({
  sourceType: knowledgeSourceTypeSchema,
  sourceProvider: z.string().max(160).nullable().optional(),
  sourceReference: z.string().max(500).nullable().optional(),
  sourceTitle: z.string().max(300).nullable().optional(),
  sourceUri: z
    .union([z.string().url().max(2000), z.literal('')])
    .nullable()
    .optional()
    .transform((value) => (value === '' ? null : value)),
  sourceCreatedAt: z.string().datetime().nullable().optional(),
  generatedByModel: z.string().max(160).nullable().optional(),
  metadata: z.record(z.unknown()).nullable().optional(),
});

export const createRecordInputSchema = z.object({
  workspaceId: z.string().uuid(),
  title: z.string().min(1).max(300),
  slug: z.string().min(1).max(96).optional(),
  summary: z.string().max(1000).optional(),
  recordType: recordTypeSchema,
  lifecycleStatus: lifecycleStatusSchema.optional(),
  sourceOfTruthMode: sourceOfTruthModeSchema.optional(),
  contentMarkdown: z.string().max(500_000).optional(),
  language: z.string().min(2).max(16).optional(),
  translationGroupId: z.string().uuid().nullable().optional(),
  projectId: z.string().uuid().nullable().optional(),
  systemId: z.string().uuid().nullable().optional(),
  tags: z.array(z.string().min(1).max(64)).max(30).optional(),
  metadata: z.record(z.unknown()).optional(),
  source: sourceInputSchema.optional(),
});

export const updateRecordInputSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  summary: z.string().max(1000).nullable().optional(),
  recordType: recordTypeSchema.optional(),
  lifecycleStatus: lifecycleStatusSchema.optional(),
  sourceOfTruthMode: sourceOfTruthModeSchema.optional(),
  contentMarkdown: z.string().max(500_000).optional(),
  language: z.string().min(2).max(16).nullable().optional(),
  translationGroupId: z.string().uuid().nullable().optional(),
  projectId: z.string().uuid().nullable().optional(),
  systemId: z.string().uuid().nullable().optional(),
  tags: z.array(z.string().min(1).max(64)).max(30).optional(),
  metadata: z.record(z.unknown()).nullable().optional(),
  changeMessage: z.string().max(500).nullable().optional(),
  lastValidatedAt: z.string().datetime().nullable().optional(),
  source: sourceInputSchema.nullable().optional(),
  archived: z.boolean().optional(),
});

export type SourceInput = z.infer<typeof sourceInputSchema>;
export type CreateRecordInput = z.infer<typeof createRecordInputSchema>;
export type UpdateRecordInput = z.infer<typeof updateRecordInputSchema>;

type SourceRow = typeof knowledgeSources.$inferSelect;
type RecordRow = typeof knowledgeRecords.$inferSelect;

export type KnowledgeActor = {
  actorType: 'user' | 'api_client';
  actorId: string;
  userId: string;
};

/** Denormalized approver snapshot kept in metadata for audit durability. */
export type ApproverSnapshot = {
  userId: string;
  displayName: string;
  email: string;
};

export type ReviewedByUser = {
  id: string;
  displayName: string;
  email: string;
};

export function withApprovedByMetadata(
  metadata: Record<string, unknown> | null | undefined,
  approver: ApproverSnapshot,
  approvedAt: Date,
): Record<string, unknown> {
  return {
    ...(metadata ?? {}),
    approvedBy: {
      userId: approver.userId,
      displayName: approver.displayName,
      email: approver.email,
      approvedAt: approvedAt.toISOString(),
    },
  };
}

export function clearApprovedByMetadata(
  metadata: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!metadata) {
    return null;
  }
  const { approvedBy: _removed, ...rest } = metadata;
  return Object.keys(rest).length > 0 ? rest : null;
}

export function approvedByFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
): ReviewedByUser | null {
  if (!metadata || typeof metadata !== 'object') {
    return null;
  }
  const raw = metadata.approvedBy;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const snap = raw as Record<string, unknown>;
  const id = typeof snap.userId === 'string' ? snap.userId : null;
  const displayName = typeof snap.displayName === 'string' ? snap.displayName : null;
  const email = typeof snap.email === 'string' ? snap.email : null;
  if (!id || !displayName) {
    return null;
  }
  return { id, displayName, email: email ?? '' };
}

export async function loadApproverSnapshot(
  database: Database,
  userId: string,
): Promise<ApproverSnapshot> {
  const [user] = await database.db
    .select({
      id: users.id,
      displayName: users.displayName,
      email: users.email,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return {
    userId,
    displayName: user?.displayName ?? 'Unknown user',
    email: user?.email ?? '',
  };
}

export async function resolveReviewedByUser(
  database: Database,
  record: Pick<RecordRow, 'reviewedBy' | 'metadataJson'>,
): Promise<ReviewedByUser | null> {
  if (record.reviewedBy) {
    const [user] = await database.db
      .select({
        id: users.id,
        displayName: users.displayName,
        email: users.email,
      })
      .from(users)
      .where(eq(users.id, record.reviewedBy))
      .limit(1);
    if (user) {
      return {
        id: user.id,
        displayName: user.displayName,
        email: user.email,
      };
    }
  }
  return approvedByFromMetadata(record.metadataJson);
}

export function toPublicSource(source: SourceRow | null) {
  if (!source) {
    return null;
  }
  return {
    id: source.id,
    sourceType: source.sourceType,
    sourceProvider: source.sourceProvider,
    sourceReference: source.sourceReference,
    sourceTitle: source.sourceTitle,
    sourceUri: source.sourceUri,
    sourceCreatedAt: source.sourceCreatedAt?.toISOString() ?? null,
    generatedByModel: source.generatedByModel,
    metadata: source.metadataJson,
    createdAt: source.createdAt.toISOString(),
  };
}

export function toPublicRecord(
  record: RecordRow,
  tagList: Array<{ id: string; name: string; slug: string }>,
  source: SourceRow | null,
  options?: {
    includeHtml?: boolean;
    includeToc?: boolean;
    /** Prefer fresh HTML from the same render pass as `toc` when provided. */
    html?: string;
    toc?: Array<{ id: string; text: string; depth: number }>;
    reviewedByUser?: ReviewedByUser | null;
  },
) {
  return {
    id: record.id,
    workspaceId: record.workspaceId,
    projectId: record.projectId,
    systemId: record.systemId,
    title: record.title,
    slug: record.slug,
    summary: record.summary,
    recordType: record.recordType,
    lifecycleStatus: record.lifecycleStatus,
    sourceOfTruthMode: record.sourceOfTruthMode,
    contentMarkdown: record.contentMarkdown,
    contentHtml: options?.includeHtml
      ? (options.html ?? record.contentHtmlCache)
      : undefined,
    toc: options?.includeToc ? (options.toc ?? []) : undefined,
    language: record.language,
    translationGroupId: record.translationGroupId,
    metadata: record.metadataJson,
    currentVersionNumber: record.currentVersionNumber,
    supersedesRecordId: record.supersedesRecordId,
    createdBy: record.createdBy,
    reviewedBy: record.reviewedBy,
    reviewedByUser:
      options?.reviewedByUser !== undefined
        ? options.reviewedByUser
        : approvedByFromMetadata(record.metadataJson),
    verifiedAt: record.verifiedAt?.toISOString() ?? null,
    lastValidatedAt: record.lastValidatedAt?.toISOString() ?? null,
    tags: tagList,
    source: toPublicSource(source),
    archivedAt: record.archivedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export async function loadPrimarySource(
  database: Database,
  recordId: string,
): Promise<SourceRow | null> {
  const [source] = await database.db
    .select()
    .from(knowledgeSources)
    .where(eq(knowledgeSources.knowledgeRecordId, recordId))
    .limit(1);
  return source ?? null;
}

export async function assertProjectInWorkspace(
  database: Database,
  workspaceId: string,
  projectId: string | null | undefined,
): Promise<void> {
  if (!projectId) {
    return;
  }
  const [project] = await database.db
    .select()
    .from(projects)
    .where(
      and(
        eq(projects.id, projectId),
        eq(projects.workspaceId, workspaceId),
        isNull(projects.archivedAt),
      ),
    )
    .limit(1);
  if (!project) {
    throw new AppError({
      code: 'PROJECT_NOT_FOUND',
      message: 'Project not found in this workspace',
      statusCode: 400,
    });
  }
}

export async function assertSystemInWorkspace(
  database: Database,
  workspaceId: string,
  systemId: string | null | undefined,
): Promise<void> {
  if (!systemId) {
    return;
  }
  const [system] = await database.db
    .select()
    .from(systems)
    .where(
      and(
        eq(systems.id, systemId),
        eq(systems.workspaceId, workspaceId),
        isNull(systems.archivedAt),
      ),
    )
    .limit(1);
  if (!system) {
    throw new AppError({
      code: 'SYSTEM_NOT_FOUND',
      message: 'System not found in this workspace',
      statusCode: 400,
    });
  }
}

export async function replaceSource(
  database: Database,
  recordId: string,
  source: SourceInput | null | undefined,
): Promise<SourceRow | null> {
  if (source === undefined) {
    return loadPrimarySource(database, recordId);
  }

  await database.db
    .delete(knowledgeSources)
    .where(eq(knowledgeSources.knowledgeRecordId, recordId));

  if (source === null) {
    return null;
  }

  const [created] = await database.db
    .insert(knowledgeSources)
    .values({
      knowledgeRecordId: recordId,
      sourceType: source.sourceType,
      sourceProvider: source.sourceProvider ?? null,
      sourceReference: source.sourceReference ?? null,
      sourceTitle: source.sourceTitle ?? null,
      sourceUri: source.sourceUri ?? null,
      sourceCreatedAt: source.sourceCreatedAt ? new Date(source.sourceCreatedAt) : null,
      generatedByModel: source.generatedByModel ?? null,
      metadataJson: source.metadata ?? null,
    })
    .returning();

  return created ?? null;
}

export async function createKnowledgeRecord(
  app: FastifyInstance,
  input: CreateRecordInput,
  actor: KnowledgeActor,
  ipAddress?: string | null,
) {
  const body = createRecordInputSchema.parse(input);

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

  const slug = body.slug ? slugify(body.slug) : slugify(body.title);
  if (!slug) {
    throw new AppError({
      code: 'VALIDATION_ERROR',
      message: 'Knowledge record slug is invalid',
      statusCode: 400,
    });
  }

  const [existing] = await app.database.db
    .select()
    .from(knowledgeRecords)
    .where(
      and(eq(knowledgeRecords.workspaceId, body.workspaceId), eq(knowledgeRecords.slug, slug)),
    )
    .limit(1);

  if (existing) {
    throw new AppError({
      code: 'KNOWLEDGE_RECORD_SLUG_CONFLICT',
      message: 'A knowledge record with this slug already exists in the workspace',
      statusCode: 409,
    });
  }

  const contentMarkdown = body.contentMarkdown ?? '';
  const rendered = await renderMarkdown(contentMarkdown);
  const lifecycleStatus = body.lifecycleStatus ?? 'draft';
  const now = new Date();
  let metadataJson = body.metadata ?? null;
  let reviewedBy: string | null = null;
  let verifiedAt: Date | null = null;
  if (lifecycleStatus === 'verified') {
    const approver = await loadApproverSnapshot(app.database, actor.userId);
    metadataJson = withApprovedByMetadata(metadataJson, approver, now);
    reviewedBy = actor.userId;
    verifiedAt = now;
  }

  const [created] = await app.database.db
    .insert(knowledgeRecords)
    .values({
      workspaceId: body.workspaceId,
      projectId: body.projectId ?? null,
      systemId: body.systemId ?? null,
      title: body.title,
      slug,
      summary: body.summary ?? null,
      recordType: body.recordType,
      lifecycleStatus,
      sourceOfTruthMode: body.sourceOfTruthMode ?? 'hub_managed',
      contentMarkdown,
      contentHtmlCache: rendered.html,
      language: body.language ?? 'en',
      translationGroupId: body.translationGroupId ?? null,
      metadataJson,
      currentVersionNumber: 1,
      createdBy: actor.userId,
      reviewedBy,
      verifiedAt,
      updatedAt: now,
    })
    .returning();

  if (!created) {
    throw new AppError({
      code: 'KNOWLEDGE_RECORD_CREATE_FAILED',
      message: 'Failed to create knowledge record',
      statusCode: 500,
    });
  }

  await insertVersionSnapshot(app.database, {
    knowledgeRecordId: created.id,
    versionNumber: 1,
    title: created.title,
    summary: created.summary,
    recordType: created.recordType,
    lifecycleStatus: created.lifecycleStatus,
    contentMarkdown: created.contentMarkdown,
    metadataJson: created.metadataJson,
    changeMessage: 'Initial version',
    createdBy: actor.userId,
  });

  let finalRecord = created;
  if (lifecycleStatus === 'current') {
    const superseded = await supersedeOtherCurrentInSeries(app.database, created);
    if (superseded.length > 0) {
      const [linked] = await app.database.db
        .update(knowledgeRecords)
        .set({
          supersedesRecordId: superseded[superseded.length - 1]?.id ?? null,
          updatedAt: new Date(),
        })
        .where(eq(knowledgeRecords.id, created.id))
        .returning();
      if (linked) {
        finalRecord = linked;
      }
    }
  }

  const tagList = await setKnowledgeRecordTags(
    app.database,
    finalRecord.id,
    workspace.organizationId,
    body.tags ?? [],
  );

  const source =
    body.source !== undefined
      ? await replaceSource(app.database, finalRecord.id, body.source)
      : await replaceSource(app.database, finalRecord.id, {
          sourceType: 'manual',
          sourceProvider: 'project-knowledge-hub',
          sourceTitle: 'Created in hub',
        });

  await writeAuditEvent(app.database, {
    organizationId: workspace.organizationId,
    actorType: actor.actorType,
    actorId: actor.actorId,
    action: 'knowledge_record.create',
    entityType: 'knowledge_record',
    entityId: finalRecord.id,
    metadata: {
      slug: finalRecord.slug,
      recordType: finalRecord.recordType,
      versionNumber: 1,
    },
    ipAddress: ipAddress ?? null,
  });

  const { maybeEnqueueEmbeddingReindex } = await import('./embedding-jobs.js');
  await maybeEnqueueEmbeddingReindex(app, finalRecord.id).catch(() => undefined);

  const reviewedByUser = await resolveReviewedByUser(app.database, finalRecord);

  return {
    knowledgeRecord: toPublicRecord(finalRecord, tagList, source, {
      includeHtml: true,
      includeToc: true,
      html: rendered.html,
      toc: rendered.toc,
      reviewedByUser,
    }),
    rendered,
  };
}

export async function updateKnowledgeRecord(
  app: FastifyInstance,
  recordId: string,
  input: UpdateRecordInput,
  actor: KnowledgeActor,
  ipAddress?: string | null,
) {
  const body = updateRecordInputSchema.parse(input);

  const [record] = await app.database.db
    .select()
    .from(knowledgeRecords)
    .where(eq(knowledgeRecords.id, recordId))
    .limit(1);

  if (!record) {
    throw new AppError({
      code: 'KNOWLEDGE_RECORD_NOT_FOUND',
      message: 'Knowledge record not found',
      statusCode: 404,
    });
  }

  if (record.sourceOfTruthMode === 'git_managed') {
    const archivalOnly =
      body.archived !== undefined &&
      Object.keys(body).every((key) => key === 'archived' || key === 'changeMessage');
    if (!archivalOnly) {
      throw new AppError({
        code: 'GIT_MANAGED_READ_ONLY',
        message:
          'Git-managed records cannot be edited in the hub; change the file in Git and re-sync',
        statusCode: 409,
      });
    }
  }

  const [workspace] = await app.database.db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, record.workspaceId))
    .limit(1);

  const nextProjectId = body.projectId === undefined ? record.projectId : body.projectId;
  const nextSystemId = body.systemId === undefined ? record.systemId : body.systemId;
  // Soft-restore may leave links to still-archived projects/systems; skip those checks.
  const restoringSoftDelete = Boolean(record.archivedAt) && body.archived === false;
  if (!restoringSoftDelete) {
    await assertProjectInWorkspace(app.database, record.workspaceId, nextProjectId);
    await assertSystemInWorkspace(app.database, record.workspaceId, nextSystemId);
  }

  const nextTitle = body.title ?? record.title;
  const nextSummary = body.summary === undefined ? record.summary : body.summary;
  const nextRecordType = body.recordType ?? record.recordType;
  const nextContent =
    body.contentMarkdown === undefined ? record.contentMarkdown : body.contentMarkdown;
  let nextMetadata = body.metadata === undefined ? record.metadataJson : body.metadata;
  const rendered = await renderMarkdown(nextContent);
  const lifecycleStatus = body.lifecycleStatus ?? record.lifecycleStatus;
  const now = new Date();

  let reviewedBy = record.reviewedBy;
  let verifiedAt = record.verifiedAt;
  if (body.lifecycleStatus === 'verified' && record.lifecycleStatus !== 'verified') {
    const approver = await loadApproverSnapshot(app.database, actor.userId);
    reviewedBy = actor.userId;
    verifiedAt = now;
    nextMetadata = withApprovedByMetadata(nextMetadata, approver, now);
  }
  if (
    body.lifecycleStatus &&
    (body.lifecycleStatus === 'draft' || body.lifecycleStatus === 'review_required')
  ) {
    reviewedBy = null;
    verifiedAt = null;
    nextMetadata = clearApprovedByMetadata(nextMetadata);
  }

  const nextLanguage =
    body.language === undefined ? record.language : body.language;
  const nextTranslationGroupId =
    body.translationGroupId === undefined
      ? record.translationGroupId
      : body.translationGroupId;

  const shouldVersion = contentFieldsChanged(record, {
    title: nextTitle,
    summary: nextSummary,
    recordType: nextRecordType,
    contentMarkdown: nextContent,
    language: nextLanguage,
    metadataJson: nextMetadata,
  });

  let nextVersionNumber = record.currentVersionNumber;
  if (shouldVersion) {
    await ensureBaselineVersion(app.database, record);
    nextVersionNumber = record.currentVersionNumber + 1;
  }

  const [updated] = await app.database.db
    .update(knowledgeRecords)
    .set({
      title: nextTitle,
      summary: nextSummary,
      recordType: nextRecordType,
      lifecycleStatus,
      sourceOfTruthMode: body.sourceOfTruthMode ?? record.sourceOfTruthMode,
      contentMarkdown: nextContent,
      contentHtmlCache: rendered.html,
      language: nextLanguage,
      translationGroupId: nextTranslationGroupId,
      projectId: nextProjectId,
      systemId: nextSystemId,
      metadataJson: nextMetadata,
      currentVersionNumber: nextVersionNumber,
      reviewedBy,
      verifiedAt,
      lastValidatedAt:
        body.lastValidatedAt === undefined
          ? record.lastValidatedAt
          : body.lastValidatedAt
            ? new Date(body.lastValidatedAt)
            : null,
      archivedAt:
        body.archived === undefined
          ? record.archivedAt
          : body.archived
            ? now
            : null,
      updatedAt: now,
    })
    .where(eq(knowledgeRecords.id, recordId))
    .returning();

  if (!updated) {
    throw new AppError({
      code: 'KNOWLEDGE_RECORD_UPDATE_FAILED',
      message: 'Failed to update knowledge record',
      statusCode: 500,
    });
  }

  if (shouldVersion) {
    await insertVersionSnapshot(app.database, {
      knowledgeRecordId: updated.id,
      versionNumber: nextVersionNumber,
      title: updated.title,
      summary: updated.summary,
      recordType: updated.recordType,
      lifecycleStatus: updated.lifecycleStatus,
      contentMarkdown: updated.contentMarkdown,
      metadataJson: updated.metadataJson,
      changeMessage: body.changeMessage ?? null,
      createdBy: actor.userId,
    });
  }

  let finalRecord = updated;
  if (lifecycleStatus === 'current' && record.lifecycleStatus !== 'current') {
    const superseded = await supersedeOtherCurrentInSeries(app.database, updated);
    if (superseded.length > 0) {
      const [linked] = await app.database.db
        .update(knowledgeRecords)
        .set({
          supersedesRecordId: superseded[superseded.length - 1]?.id ?? null,
          updatedAt: new Date(),
        })
        .where(eq(knowledgeRecords.id, updated.id))
        .returning();
      if (linked) {
        finalRecord = linked;
      }
    }
  }

  let tagList =
    (await getKnowledgeRecordTags(app.database, [finalRecord.id])).get(finalRecord.id) ?? [];
  if (body.tags && workspace) {
    tagList = await setKnowledgeRecordTags(
      app.database,
      finalRecord.id,
      workspace.organizationId,
      body.tags,
    );
  }

  const source = await replaceSource(app.database, finalRecord.id, body.source);

  const reviewedByUser = await resolveReviewedByUser(app.database, finalRecord);

  await writeAuditEvent(app.database, {
    organizationId: workspace?.organizationId ?? null,
    actorType: actor.actorType,
    actorId: actor.actorId,
    action: 'knowledge_record.update',
    entityType: 'knowledge_record',
    entityId: finalRecord.id,
    metadata: {
      lifecycleStatus: finalRecord.lifecycleStatus,
      versionNumber: finalRecord.currentVersionNumber,
      versioned: shouldVersion,
      fields: Object.keys(body),
      ...(body.lifecycleStatus === 'verified' && reviewedByUser
        ? {
            approvedBy: {
              userId: reviewedByUser.id,
              displayName: reviewedByUser.displayName,
              email: reviewedByUser.email,
            },
          }
        : {}),
    },
    ipAddress: ipAddress ?? null,
  });

  if (shouldVersion || body.contentMarkdown !== undefined || body.title !== undefined) {
    const { maybeEnqueueEmbeddingReindex } = await import('./embedding-jobs.js');
    await maybeEnqueueEmbeddingReindex(app, finalRecord.id).catch(() => undefined);
  }

  return {
    knowledgeRecord: toPublicRecord(finalRecord, tagList, source, {
      includeHtml: true,
      includeToc: true,
      html: rendered.html,
      toc: rendered.toc,
      reviewedByUser,
    }),
    rendered,
    shouldVersion,
  };
}
