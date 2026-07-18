import type { FastifyInstance } from 'fastify';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { slugify } from '@project-knowledge-hub/auth';
import {
  knowledgeRecords,
  knowledgeSources,
  projects,
  systems,
  workspaces,
} from '@project-knowledge-hub/database';
import {
  AppError,
  knowledgeSourceTypeSchema,
  lifecycleStatusSchema,
  recordTypeSchema,
  sourceOfTruthModeSchema,
} from '@project-knowledge-hub/domain';
import { renderMarkdown } from '@project-knowledge-hub/markdown';
import {
  requireWorkspaceMaintainer,
  requireWorkspaceView,
} from '@project-knowledge-hub/permissions';
import {
  assertMutatingOrigin,
  requireAuthenticated,
} from '../plugins/auth.js';
import { writeAuditEvent } from '../lib/identity.js';
import {
  contentFieldsChanged,
  ensureBaselineVersion,
  getVersion,
  insertVersionSnapshot,
  listVersions,
  supersedeOtherCurrentInSeries,
  toPublicVersion,
} from '../lib/knowledge-versions.js';
import {
  getKnowledgeRecordTags,
  setKnowledgeRecordTags,
} from '../lib/tags.js';

const sourceInputSchema = z.object({
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

const createRecordSchema = z.object({
  workspaceId: z.string().uuid(),
  title: z.string().min(1).max(300),
  slug: z.string().min(1).max(96).optional(),
  summary: z.string().max(1000).optional(),
  recordType: recordTypeSchema,
  lifecycleStatus: lifecycleStatusSchema.optional(),
  sourceOfTruthMode: sourceOfTruthModeSchema.optional(),
  contentMarkdown: z.string().max(500_000).optional(),
  language: z.string().min(2).max(16).optional(),
  projectId: z.string().uuid().nullable().optional(),
  systemId: z.string().uuid().nullable().optional(),
  tags: z.array(z.string().min(1).max(64)).max(30).optional(),
  metadata: z.record(z.unknown()).optional(),
  source: sourceInputSchema.optional(),
});

const updateRecordSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  summary: z.string().max(1000).nullable().optional(),
  recordType: recordTypeSchema.optional(),
  lifecycleStatus: lifecycleStatusSchema.optional(),
  sourceOfTruthMode: sourceOfTruthModeSchema.optional(),
  contentMarkdown: z.string().max(500_000).optional(),
  language: z.string().min(2).max(16).nullable().optional(),
  projectId: z.string().uuid().nullable().optional(),
  systemId: z.string().uuid().nullable().optional(),
  tags: z.array(z.string().min(1).max(64)).max(30).optional(),
  metadata: z.record(z.unknown()).nullable().optional(),
  changeMessage: z.string().max(500).nullable().optional(),
  lastValidatedAt: z.string().datetime().nullable().optional(),
  source: sourceInputSchema.nullable().optional(),
  archived: z.boolean().optional(),
});

const restoreSchema = z.object({
  changeMessage: z.string().max(500).optional(),
});

type SourceRow = typeof knowledgeSources.$inferSelect;
type RecordRow = typeof knowledgeRecords.$inferSelect;

function toPublicSource(source: SourceRow | null) {
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

function toPublicRecord(
  record: RecordRow,
  tagList: Array<{ id: string; name: string; slug: string }>,
  source: SourceRow | null,
  options?: { includeHtml?: boolean; includeToc?: boolean; toc?: Array<{
    id: string;
    text: string;
    depth: number;
  }> },
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
    contentHtml: options?.includeHtml ? record.contentHtmlCache : undefined,
    toc: options?.includeToc ? (options.toc ?? []) : undefined,
    language: record.language,
    metadata: record.metadataJson,
    currentVersionNumber: record.currentVersionNumber,
    supersedesRecordId: record.supersedesRecordId,
    createdBy: record.createdBy,
    reviewedBy: record.reviewedBy,
    verifiedAt: record.verifiedAt?.toISOString() ?? null,
    lastValidatedAt: record.lastValidatedAt?.toISOString() ?? null,
    tags: tagList,
    source: toPublicSource(source),
    archivedAt: record.archivedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

async function loadPrimarySource(
  app: FastifyInstance,
  recordId: string,
): Promise<SourceRow | null> {
  const [source] = await app.database.db
    .select()
    .from(knowledgeSources)
    .where(eq(knowledgeSources.knowledgeRecordId, recordId))
    .limit(1);
  return source ?? null;
}

async function assertProjectInWorkspace(
  app: FastifyInstance,
  workspaceId: string,
  projectId: string | null | undefined,
): Promise<void> {
  if (!projectId) {
    return;
  }
  const [project] = await app.database.db
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

async function assertSystemInWorkspace(
  app: FastifyInstance,
  workspaceId: string,
  systemId: string | null | undefined,
): Promise<void> {
  if (!systemId) {
    return;
  }
  const [system] = await app.database.db
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

async function replaceSource(
  app: FastifyInstance,
  recordId: string,
  source: z.infer<typeof sourceInputSchema> | null | undefined,
): Promise<SourceRow | null> {
  if (source === undefined) {
    return loadPrimarySource(app, recordId);
  }

  await app.database.db
    .delete(knowledgeSources)
    .where(eq(knowledgeSources.knowledgeRecordId, recordId));

  if (source === null) {
    return null;
  }

  const [created] = await app.database.db
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

export async function registerKnowledgeRecordRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/knowledge-records', async (request) => {
    const principal = requireAuthenticated(request);
    const query = z
      .object({
        workspaceId: z.string().uuid(),
        projectId: z.string().uuid().optional(),
        systemId: z.string().uuid().optional(),
        includeArchived: z
          .enum(['true', 'false'])
          .optional()
          .transform((value) => value === 'true'),
      })
      .parse(request.query);

    requireWorkspaceView(principal, query.workspaceId);

    const conditions = [eq(knowledgeRecords.workspaceId, query.workspaceId)];
    if (!query.includeArchived) {
      conditions.push(isNull(knowledgeRecords.archivedAt));
    }
    if (query.projectId) {
      conditions.push(eq(knowledgeRecords.projectId, query.projectId));
    }
    if (query.systemId) {
      conditions.push(eq(knowledgeRecords.systemId, query.systemId));
    }

    const rows = await app.database.db
      .select()
      .from(knowledgeRecords)
      .where(and(...conditions));

    const tagMap = await getKnowledgeRecordTags(
      app.database,
      rows.map((row) => row.id),
    );

    return {
      knowledgeRecords: rows.map((row) =>
        toPublicRecord(row, tagMap.get(row.id) ?? [], null),
      ),
    };
  });

  app.post('/api/v1/knowledge-records', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    const body = createRecordSchema.parse(request.body);
    requireWorkspaceMaintainer(principal, body.workspaceId);

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

    await assertProjectInWorkspace(app, body.workspaceId, body.projectId);
    await assertSystemInWorkspace(app, body.workspaceId, body.systemId);

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
        metadataJson: body.metadata ?? null,
        currentVersionNumber: 1,
        createdBy: principal.userId,
        reviewedBy: lifecycleStatus === 'verified' ? principal.userId : null,
        verifiedAt: lifecycleStatus === 'verified' ? now : null,
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
      createdBy: principal.userId,
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
        ? await replaceSource(app, finalRecord.id, body.source)
        : await replaceSource(app, finalRecord.id, {
            sourceType: 'manual',
            sourceProvider: 'project-knowledge-hub',
            sourceTitle: 'Created in hub',
          });

    await writeAuditEvent(app.database, {
      organizationId: workspace.organizationId,
      actorType: 'user',
      actorId: principal.userId,
      action: 'knowledge_record.create',
      entityType: 'knowledge_record',
      entityId: finalRecord.id,
      metadata: {
        slug: finalRecord.slug,
        recordType: finalRecord.recordType,
        versionNumber: 1,
      },
      ipAddress: request.ip,
    });

    return {
      knowledgeRecord: toPublicRecord(finalRecord, tagList, source, {
        includeHtml: true,
        includeToc: true,
        toc: rendered.toc,
      }),
    };
  });

  app.get('/api/v1/knowledge-records/:recordId', async (request) => {
    const principal = requireAuthenticated(request);
    const params = z.object({ recordId: z.string().uuid() }).parse(request.params);
    const [record] = await app.database.db
      .select()
      .from(knowledgeRecords)
      .where(eq(knowledgeRecords.id, params.recordId))
      .limit(1);

    if (!record || record.archivedAt) {
      throw new AppError({
        code: 'KNOWLEDGE_RECORD_NOT_FOUND',
        message: 'Knowledge record not found',
        statusCode: 404,
      });
    }

    requireWorkspaceView(principal, record.workspaceId);
    const tagMap = await getKnowledgeRecordTags(app.database, [record.id]);
    const source = await loadPrimarySource(app, record.id);
    const rendered = await renderMarkdown(record.contentMarkdown);

    return {
      knowledgeRecord: toPublicRecord(record, tagMap.get(record.id) ?? [], source, {
        includeHtml: true,
        includeToc: true,
        toc: rendered.toc,
      }),
    };
  });

  app.patch('/api/v1/knowledge-records/:recordId', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    const params = z.object({ recordId: z.string().uuid() }).parse(request.params);
    const body = updateRecordSchema.parse(request.body);

    const [record] = await app.database.db
      .select()
      .from(knowledgeRecords)
      .where(eq(knowledgeRecords.id, params.recordId))
      .limit(1);

    if (!record) {
      throw new AppError({
        code: 'KNOWLEDGE_RECORD_NOT_FOUND',
        message: 'Knowledge record not found',
        statusCode: 404,
      });
    }

    requireWorkspaceMaintainer(principal, record.workspaceId);

    const [workspace] = await app.database.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, record.workspaceId))
      .limit(1);

    const nextProjectId = body.projectId === undefined ? record.projectId : body.projectId;
    const nextSystemId = body.systemId === undefined ? record.systemId : body.systemId;
    await assertProjectInWorkspace(app, record.workspaceId, nextProjectId);
    await assertSystemInWorkspace(app, record.workspaceId, nextSystemId);

    const nextTitle = body.title ?? record.title;
    const nextSummary = body.summary === undefined ? record.summary : body.summary;
    const nextRecordType = body.recordType ?? record.recordType;
    const nextContent =
      body.contentMarkdown === undefined ? record.contentMarkdown : body.contentMarkdown;
    const nextMetadata = body.metadata === undefined ? record.metadataJson : body.metadata;
    const rendered = await renderMarkdown(nextContent);
    const lifecycleStatus = body.lifecycleStatus ?? record.lifecycleStatus;
    const now = new Date();

    let reviewedBy = record.reviewedBy;
    let verifiedAt = record.verifiedAt;
    if (body.lifecycleStatus === 'verified' && record.lifecycleStatus !== 'verified') {
      reviewedBy = principal.userId;
      verifiedAt = now;
    }
    if (
      body.lifecycleStatus &&
      (body.lifecycleStatus === 'draft' || body.lifecycleStatus === 'review_required')
    ) {
      reviewedBy = null;
      verifiedAt = null;
    }

    const shouldVersion = contentFieldsChanged(record, {
      title: nextTitle,
      summary: nextSummary,
      recordType: nextRecordType,
      contentMarkdown: nextContent,
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
        language: body.language === undefined ? record.language : body.language,
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
      .where(eq(knowledgeRecords.id, params.recordId))
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
        createdBy: principal.userId,
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

    const source = await replaceSource(app, finalRecord.id, body.source);

    await writeAuditEvent(app.database, {
      organizationId: workspace?.organizationId ?? null,
      actorType: 'user',
      actorId: principal.userId,
      action: 'knowledge_record.update',
      entityType: 'knowledge_record',
      entityId: finalRecord.id,
      metadata: {
        lifecycleStatus: finalRecord.lifecycleStatus,
        versionNumber: finalRecord.currentVersionNumber,
        versioned: shouldVersion,
        fields: Object.keys(body),
      },
      ipAddress: request.ip,
    });

    return {
      knowledgeRecord: toPublicRecord(finalRecord, tagList, source, {
        includeHtml: true,
        includeToc: true,
        toc: rendered.toc,
      }),
    };
  });

  app.get('/api/v1/knowledge-records/:recordId/versions', async (request) => {
    const principal = requireAuthenticated(request);
    const params = z.object({ recordId: z.string().uuid() }).parse(request.params);
    const [record] = await app.database.db
      .select()
      .from(knowledgeRecords)
      .where(eq(knowledgeRecords.id, params.recordId))
      .limit(1);

    if (!record || record.archivedAt) {
      throw new AppError({
        code: 'KNOWLEDGE_RECORD_NOT_FOUND',
        message: 'Knowledge record not found',
        statusCode: 404,
      });
    }

    requireWorkspaceView(principal, record.workspaceId);
    await ensureBaselineVersion(app.database, record);
    const versions = await listVersions(app.database, record.id);
    return {
      versions: versions.map(toPublicVersion),
      currentVersionNumber: record.currentVersionNumber,
    };
  });

  app.get('/api/v1/knowledge-records/:recordId/versions/:versionNumber', async (request) => {
    const principal = requireAuthenticated(request);
    const params = z
      .object({
        recordId: z.string().uuid(),
        versionNumber: z.coerce.number().int().positive(),
      })
      .parse(request.params);

    const [record] = await app.database.db
      .select()
      .from(knowledgeRecords)
      .where(eq(knowledgeRecords.id, params.recordId))
      .limit(1);

    if (!record || record.archivedAt) {
      throw new AppError({
        code: 'KNOWLEDGE_RECORD_NOT_FOUND',
        message: 'Knowledge record not found',
        statusCode: 404,
      });
    }

    requireWorkspaceView(principal, record.workspaceId);
    const version = await getVersion(app.database, record.id, params.versionNumber);
    if (!version) {
      throw new AppError({
        code: 'KNOWLEDGE_VERSION_NOT_FOUND',
        message: 'Version not found',
        statusCode: 404,
      });
    }

    const rendered = await renderMarkdown(version.contentMarkdown);
    return {
      version: {
        ...toPublicVersion(version),
        contentHtml: rendered.html,
        toc: rendered.toc,
        isCurrent: version.versionNumber === record.currentVersionNumber,
        isHistorical: version.versionNumber !== record.currentVersionNumber,
      },
    };
  });

  app.post('/api/v1/knowledge-records/:recordId/versions/:versionNumber/restore', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    const params = z
      .object({
        recordId: z.string().uuid(),
        versionNumber: z.coerce.number().int().positive(),
      })
      .parse(request.params);
    const body = restoreSchema.parse(request.body ?? {});

    const [record] = await app.database.db
      .select()
      .from(knowledgeRecords)
      .where(eq(knowledgeRecords.id, params.recordId))
      .limit(1);

    if (!record || record.archivedAt) {
      throw new AppError({
        code: 'KNOWLEDGE_RECORD_NOT_FOUND',
        message: 'Knowledge record not found',
        statusCode: 404,
      });
    }

    requireWorkspaceMaintainer(principal, record.workspaceId);
    await ensureBaselineVersion(app.database, record);

    const version = await getVersion(app.database, record.id, params.versionNumber);
    if (!version) {
      throw new AppError({
        code: 'KNOWLEDGE_VERSION_NOT_FOUND',
        message: 'Version not found',
        statusCode: 404,
      });
    }

    const nextVersionNumber = record.currentVersionNumber + 1;
    const rendered = await renderMarkdown(version.contentMarkdown);
    const now = new Date();

    const [updated] = await app.database.db
      .update(knowledgeRecords)
      .set({
        title: version.title,
        summary: version.summary,
        recordType: version.recordType,
        contentMarkdown: version.contentMarkdown,
        contentHtmlCache: rendered.html,
        metadataJson: version.metadataJson,
        currentVersionNumber: nextVersionNumber,
        updatedAt: now,
      })
      .where(eq(knowledgeRecords.id, record.id))
      .returning();

    if (!updated) {
      throw new AppError({
        code: 'KNOWLEDGE_RECORD_RESTORE_FAILED',
        message: 'Failed to restore version',
        statusCode: 500,
      });
    }

    await insertVersionSnapshot(app.database, {
      knowledgeRecordId: updated.id,
      versionNumber: nextVersionNumber,
      title: updated.title,
      summary: updated.summary,
      recordType: updated.recordType,
      lifecycleStatus: updated.lifecycleStatus,
      contentMarkdown: updated.contentMarkdown,
      metadataJson: updated.metadataJson,
      changeMessage:
        body.changeMessage ?? `Restored from version ${params.versionNumber}`,
      createdBy: principal.userId,
    });

    const [workspace] = await app.database.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, record.workspaceId))
      .limit(1);

    await writeAuditEvent(app.database, {
      organizationId: workspace?.organizationId ?? null,
      actorType: 'user',
      actorId: principal.userId,
      action: 'knowledge_record.restore',
      entityType: 'knowledge_record',
      entityId: updated.id,
      metadata: {
        restoredFrom: params.versionNumber,
        versionNumber: nextVersionNumber,
      },
      ipAddress: request.ip,
    });

    const tagMap = await getKnowledgeRecordTags(app.database, [updated.id]);
    const source = await loadPrimarySource(app, updated.id);
    return {
      knowledgeRecord: toPublicRecord(updated, tagMap.get(updated.id) ?? [], source, {
        includeHtml: true,
        includeToc: true,
        toc: rendered.toc,
      }),
    };
  });

  app.post('/api/v1/knowledge-records/:recordId/verify', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    const params = z.object({ recordId: z.string().uuid() }).parse(request.params);

    const [record] = await app.database.db
      .select()
      .from(knowledgeRecords)
      .where(eq(knowledgeRecords.id, params.recordId))
      .limit(1);

    if (!record || record.archivedAt) {
      throw new AppError({
        code: 'KNOWLEDGE_RECORD_NOT_FOUND',
        message: 'Knowledge record not found',
        statusCode: 404,
      });
    }

    requireWorkspaceMaintainer(principal, record.workspaceId);
    const now = new Date();

    const [updated] = await app.database.db
      .update(knowledgeRecords)
      .set({
        lifecycleStatus: 'verified',
        reviewedBy: principal.userId,
        verifiedAt: now,
        updatedAt: now,
      })
      .where(eq(knowledgeRecords.id, record.id))
      .returning();

    if (!updated) {
      throw new AppError({
        code: 'KNOWLEDGE_RECORD_VERIFY_FAILED',
        message: 'Failed to verify knowledge record',
        statusCode: 500,
      });
    }

    const [workspace] = await app.database.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, record.workspaceId))
      .limit(1);

    await writeAuditEvent(app.database, {
      organizationId: workspace?.organizationId ?? null,
      actorType: 'user',
      actorId: principal.userId,
      action: 'knowledge_record.verify',
      entityType: 'knowledge_record',
      entityId: updated.id,
      ipAddress: request.ip,
    });

    const tagMap = await getKnowledgeRecordTags(app.database, [updated.id]);
    const source = await loadPrimarySource(app, updated.id);
    const rendered = await renderMarkdown(updated.contentMarkdown);
    return {
      knowledgeRecord: toPublicRecord(updated, tagMap.get(updated.id) ?? [], source, {
        includeHtml: true,
        includeToc: true,
        toc: rendered.toc,
      }),
    };
  });

  app.post('/api/v1/knowledge-records/:recordId/mark-current', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    const params = z.object({ recordId: z.string().uuid() }).parse(request.params);

    const [record] = await app.database.db
      .select()
      .from(knowledgeRecords)
      .where(eq(knowledgeRecords.id, params.recordId))
      .limit(1);

    if (!record || record.archivedAt) {
      throw new AppError({
        code: 'KNOWLEDGE_RECORD_NOT_FOUND',
        message: 'Knowledge record not found',
        statusCode: 404,
      });
    }

    requireWorkspaceMaintainer(principal, record.workspaceId);

    const superseded = await supersedeOtherCurrentInSeries(app.database, record);
    const now = new Date();

    const [updated] = await app.database.db
      .update(knowledgeRecords)
      .set({
        lifecycleStatus: 'current',
        supersedesRecordId:
          superseded.length > 0
            ? (superseded[superseded.length - 1]?.id ?? record.supersedesRecordId)
            : record.supersedesRecordId,
        reviewedBy: record.reviewedBy ?? principal.userId,
        verifiedAt: record.verifiedAt ?? now,
        updatedAt: now,
      })
      .where(eq(knowledgeRecords.id, record.id))
      .returning();

    if (!updated) {
      throw new AppError({
        code: 'KNOWLEDGE_RECORD_MARK_CURRENT_FAILED',
        message: 'Failed to mark record as current',
        statusCode: 500,
      });
    }

    const [workspace] = await app.database.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, record.workspaceId))
      .limit(1);

    await writeAuditEvent(app.database, {
      organizationId: workspace?.organizationId ?? null,
      actorType: 'user',
      actorId: principal.userId,
      action: 'knowledge_record.mark_current',
      entityType: 'knowledge_record',
      entityId: updated.id,
      metadata: { superseded },
      ipAddress: request.ip,
    });

    const tagMap = await getKnowledgeRecordTags(app.database, [updated.id]);
    const source = await loadPrimarySource(app, updated.id);
    const rendered = await renderMarkdown(updated.contentMarkdown);
    return {
      knowledgeRecord: toPublicRecord(updated, tagMap.get(updated.id) ?? [], source, {
        includeHtml: true,
        includeToc: true,
        toc: rendered.toc,
      }),
      superseded,
    };
  });

  app.delete('/api/v1/knowledge-records/:recordId', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    const params = z.object({ recordId: z.string().uuid() }).parse(request.params);

    const [record] = await app.database.db
      .select()
      .from(knowledgeRecords)
      .where(eq(knowledgeRecords.id, params.recordId))
      .limit(1);

    if (!record || record.archivedAt) {
      throw new AppError({
        code: 'KNOWLEDGE_RECORD_NOT_FOUND',
        message: 'Knowledge record not found',
        statusCode: 404,
      });
    }

    requireWorkspaceMaintainer(principal, record.workspaceId);

    const [archived] = await app.database.db
      .update(knowledgeRecords)
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(eq(knowledgeRecords.id, params.recordId))
      .returning();

    const [workspace] = await app.database.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, record.workspaceId))
      .limit(1);

    await writeAuditEvent(app.database, {
      organizationId: workspace?.organizationId ?? null,
      actorType: 'user',
      actorId: principal.userId,
      action: 'knowledge_record.archive',
      entityType: 'knowledge_record',
      entityId: record.id,
      ipAddress: request.ip,
    });

    const tagMap = await getKnowledgeRecordTags(app.database, [record.id]);
    const source = await loadPrimarySource(app, record.id);
    return {
      knowledgeRecord: archived
        ? toPublicRecord(archived, tagMap.get(archived.id) ?? [], source)
        : null,
    };
  });
}
