import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  knowledgeRecords,
  knowledgeSources,
  projects,
  systems,
  workspaces,
} from '@project-knowledge-hub/database';
import {
  AppError,
  buildKnowledgeRecordMetadata,
  milestoneStatusSchema,
  raciRoleSchema,
  recordTypeSchema,
  taskStatusSchema,
} from '@project-knowledge-hub/domain';
import {
  truncateContent,
  type McpClientContext,
  type McpToolHandlers,
} from '@project-knowledge-hub/mcp';
import { runSearch } from './search-service.js';
import { writeAuditEvent } from './identity.js';
import {
  createKnowledgeRecord,
  createRecordTranslation,
  listRecordTranslations,
  resolveReviewedByUser,
  updateKnowledgeRecord,
} from './knowledge-records-service.js';
import {
  appendMediaUploadChunk,
  beginMediaUploadSession,
  takeMediaUploadSession,
} from './media-upload-session.js';
import {
  archiveWorkspaceMedia,
  createWorkspaceMedia,
  getWorkspaceMediaById,
  listWorkspaceMedia,
  toPublicMedia,
  type PublicWorkspaceMedia,
} from './workspace-media.js';
import { buildSupportDump } from './support-dump.js';
import {
  auditKnowledgeSearch,
  auditKnowledgeView,
} from './telemetry-audit.js';
import {
  assertProjectNotArchived,
  createMilestone,
  createTask,
  getMilestone,
  getTask,
  listMilestones,
  listTasks,
  replaceTaskRaci,
  requireProjectContext,
  updateMilestone,
  updateTask,
} from './project-delivery.js';

function assertWorkspaceAllowed(client: McpClientContext, workspaceId: string): void {
  if (
    client.allowedWorkspaceIds.length > 0 &&
    !client.allowedWorkspaceIds.includes(workspaceId)
  ) {
    throw new AppError({
      code: 'FORBIDDEN',
      message: 'Workspace is not allowed for this API client',
      statusCode: 403,
    });
  }
}

function assertWriteWorkspaceAllowed(client: McpClientContext, workspaceId: string): void {
  if (client.allowedWorkspaceIds.length === 0) {
    throw new AppError({
      code: 'FORBIDDEN',
      message: 'Write-capable API clients must have a non-empty workspace allowlist',
      statusCode: 403,
    });
  }
  if (!client.allowedWorkspaceIds.includes(workspaceId)) {
    throw new AppError({
      code: 'FORBIDDEN',
      message: 'Workspace is not allowed for this API client',
      statusCode: 403,
    });
  }
}

function requireActingUserId(client: McpClientContext): string {
  if (!client.actingUserId) {
    throw new AppError({
      code: 'ACTING_USER_REQUIRED',
      message:
        'API client is missing actingUserId required for knowledge:write or pm:write',
      statusCode: 403,
    });
  }
  return client.actingUserId;
}

async function requirePmProject(
  app: FastifyInstance,
  client: McpClientContext,
  projectId: string,
  opts?: { forWrite?: boolean },
) {
  const { project } = await requireProjectContext(app.database, projectId);
  assertWorkspaceAllowed(client, project.workspaceId);
  assertProjectAllowed(client, project.id);
  if (opts?.forWrite) {
    assertWriteWorkspaceAllowed(client, project.workspaceId);
    assertProjectNotArchived(project);
  }
  return project;
}

async function embedMediaIntoRecord(
  app: FastifyInstance,
  client: McpClientContext,
  actingUserId: string,
  media: PublicWorkspaceMedia,
  knowledgeRecordId: string,
  workspaceId: string,
  ipAddress?: string | null,
) {
  const [existing] = await app.database.db
    .select()
    .from(knowledgeRecords)
    .where(
      and(eq(knowledgeRecords.id, knowledgeRecordId), isNull(knowledgeRecords.archivedAt)),
    )
    .limit(1);
  if (!existing) {
    throw new AppError({
      code: 'KNOWLEDGE_RECORD_NOT_FOUND',
      message: 'Knowledge record not found for insertIntoRecord',
      statusCode: 404,
    });
  }
  if (existing.workspaceId !== workspaceId) {
    throw new AppError({
      code: 'VALIDATION_ERROR',
      message: 'knowledgeRecordId is not in the given workspace',
      statusCode: 400,
    });
  }

  const alreadyEmbedded = existing.contentMarkdown.includes(media.url);
  const nextContent = alreadyEmbedded
    ? existing.contentMarkdown
    : `${existing.contentMarkdown.replace(/\s*$/, '')}\n\n${media.markdownSnippet}\n`;

  const updated = alreadyEmbedded
    ? null
    : await updateKnowledgeRecord(
        app,
        existing.id,
        {
          contentMarkdown: nextContent,
          changeMessage: `Embed media ${media.id}`,
          lifecycleStatus: 'draft',
          sourceOfTruthMode: 'ai_generated_draft',
        },
        {
          actorType: 'api_client',
          actorId: client.id,
          userId: actingUserId,
        },
        ipAddress,
      );

  return {
    media,
    insertedIntoRecord: !alreadyEmbedded,
    alreadyEmbedded,
    knowledgeRecord: updated
      ? {
          id: updated.knowledgeRecord.id,
          slug: updated.knowledgeRecord.slug,
          currentVersionNumber: updated.knowledgeRecord.currentVersionNumber,
          lifecycleStatus: updated.knowledgeRecord.lifecycleStatus,
        }
      : {
          id: existing.id,
          slug: existing.slug,
          currentVersionNumber: existing.currentVersionNumber,
          lifecycleStatus: existing.lifecycleStatus,
        },
  };
}

function assertProjectAllowed(client: McpClientContext, projectId: string | null): void {
  if (!projectId || client.allowedProjectIds.length === 0) {
    return;
  }
  if (!client.allowedProjectIds.includes(projectId)) {
    throw new AppError({
      code: 'FORBIDDEN',
      message: 'Project is not allowed for this API client',
      statusCode: 403,
    });
  }
}

async function resolveWorkspaceFilter(
  app: FastifyInstance,
  client: McpClientContext,
  workspaceId?: string,
): Promise<string[]> {
  if (workspaceId) {
    assertWorkspaceAllowed(client, workspaceId);
    return [workspaceId];
  }
  if (client.allowedWorkspaceIds.length > 0) {
    return client.allowedWorkspaceIds;
  }
  const rows = await app.database.db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(
      and(
        eq(workspaces.organizationId, client.organizationId),
        isNull(workspaces.archivedAt),
      ),
    );
  return rows.map((row) => row.id);
}

export function createMcpToolHandlers(
  app: FastifyInstance,
  client: McpClientContext,
  ipAddress?: string | null,
): McpToolHandlers {
  return {
    async listProjects({ workspaceId, limit }) {
      const workspaceIds = await resolveWorkspaceFilter(app, client, workspaceId);
      if (workspaceIds.length === 0) {
        return { projects: [] };
      }
      const rows = await app.database.db
        .select()
        .from(projects)
        .where(and(inArray(projects.workspaceId, workspaceIds), isNull(projects.archivedAt)))
        .limit(limit);
      const filtered = rows.filter((row) => {
        try {
          assertProjectAllowed(client, row.id);
          return true;
        } catch {
          return false;
        }
      });
      return {
        projects: filtered.map((row) => ({
          id: row.id,
          workspaceId: row.workspaceId,
          name: row.name,
          slug: row.slug,
          status: row.status,
          summary: row.summary,
        })),
      };
    },

    async listSystems({ workspaceId, projectId, limit }) {
      const workspaceIds = await resolveWorkspaceFilter(app, client, workspaceId);
      if (workspaceIds.length === 0) {
        return { systems: [] };
      }
      if (projectId) {
        assertProjectAllowed(client, projectId);
      }
      const conditions = [
        inArray(systems.workspaceId, workspaceIds),
        isNull(systems.archivedAt),
      ];
      if (projectId) {
        conditions.push(eq(systems.projectId, projectId));
      }
      const rows = await app.database.db
        .select()
        .from(systems)
        .where(and(...conditions))
        .limit(limit);
      return {
        systems: rows
          .filter((row) => {
            try {
              assertProjectAllowed(client, row.projectId);
              return true;
            } catch {
              return false;
            }
          })
          .map((row) => ({
            id: row.id,
            workspaceId: row.workspaceId,
            projectId: row.projectId,
            name: row.name,
            slug: row.slug,
            status: row.status,
            summary: row.summary,
          })),
      };
    },

    async getProject({ projectId }) {
      const [project] = await app.database.db
        .select()
        .from(projects)
        .where(and(eq(projects.id, projectId), isNull(projects.archivedAt)))
        .limit(1);
      if (!project) {
        throw new AppError({
          code: 'PROJECT_NOT_FOUND',
          message: 'Project not found',
          statusCode: 404,
        });
      }
      assertWorkspaceAllowed(client, project.workspaceId);
      assertProjectAllowed(client, project.id);
      return {
        project: {
          id: project.id,
          workspaceId: project.workspaceId,
          name: project.name,
          slug: project.slug,
          status: project.status,
          summary: project.summary,
          description: project.description,
        },
      };
    },

    async getSystem({ systemId }) {
      const [system] = await app.database.db
        .select()
        .from(systems)
        .where(and(eq(systems.id, systemId), isNull(systems.archivedAt)))
        .limit(1);
      if (!system) {
        throw new AppError({
          code: 'SYSTEM_NOT_FOUND',
          message: 'System not found',
          statusCode: 404,
        });
      }
      assertWorkspaceAllowed(client, system.workspaceId);
      assertProjectAllowed(client, system.projectId);
      return {
        system: {
          id: system.id,
          workspaceId: system.workspaceId,
          projectId: system.projectId,
          name: system.name,
          slug: system.slug,
          status: system.status,
          summary: system.summary,
          description: system.description,
        },
      };
    },

    async listKnowledgeRecords({ workspaceId, projectId, systemId, language, limit }) {
      assertWorkspaceAllowed(client, workspaceId);
      if (projectId) {
        assertProjectAllowed(client, projectId);
      }
      const conditions = [
        eq(knowledgeRecords.workspaceId, workspaceId),
        isNull(knowledgeRecords.archivedAt),
      ];
      if (projectId) {
        conditions.push(eq(knowledgeRecords.projectId, projectId));
      }
      if (systemId) {
        conditions.push(eq(knowledgeRecords.systemId, systemId));
      }
      if (language) {
        conditions.push(eq(knowledgeRecords.language, language));
      }
      const rows = await app.database.db
        .select()
        .from(knowledgeRecords)
        .where(and(...conditions))
        .limit(limit);
      return {
        knowledgeRecords: rows
          .filter((row) => {
            try {
              assertProjectAllowed(client, row.projectId);
              return true;
            } catch {
              return false;
            }
          })
          .map((row) => ({
            id: row.id,
            title: row.title,
            slug: row.slug,
            recordType: row.recordType,
            lifecycleStatus: row.lifecycleStatus,
            summary: row.summary,
            language: row.language,
            translationGroupId: row.translationGroupId,
            projectId: row.projectId,
            systemId: row.systemId,
            verifiedAt: row.verifiedAt?.toISOString() ?? null,
            updatedAt: row.updatedAt.toISOString(),
          })),
      };
    },

    async searchKnowledge(input) {
      assertWorkspaceAllowed(client, input.workspaceId);
      if (input.projectIds) {
        for (const projectId of input.projectIds) {
          assertProjectAllowed(client, projectId);
        }
      }
      const projectId = input.projectIds?.[0];
      const systemId = input.systemIds?.[0];
      const result = await runSearch(app, {
        workspaceId: input.workspaceId,
        query: input.query,
        projectId,
        systemId,
        language: input.language,
        recordTypes: input.recordTypes as never,
        lifecycleStatuses: input.statuses as never,
        limit: input.limit,
        mode: input.mode === 'hybrid' ? 'hybrid' : 'fts',
        verifiedOnly: input.statuses?.every((status) =>
          ['verified', 'current'].includes(status),
        ),
      });
      const filtered = result.results.filter((item) => {
        try {
          assertProjectAllowed(client, item.projectId);
          return true;
        } catch {
          return false;
        }
      });
      await auditKnowledgeSearch({
        database: app.database,
        organizationId: client.organizationId,
        actorType: 'api_client',
        actorId: client.id,
        workspaceId: input.workspaceId,
        query: input.query,
        mode: result.mode,
        resultCount: filtered.length,
        projectId,
        systemId,
        via: 'mcp',
        ipAddress,
      });
      return {
        ...result,
        results: filtered,
      };
    },

    async getKnowledgeRecord({ recordId }) {
      const [record] = await app.database.db
        .select()
        .from(knowledgeRecords)
        .where(and(eq(knowledgeRecords.id, recordId), isNull(knowledgeRecords.archivedAt)))
        .limit(1);
      if (!record) {
        throw new AppError({
          code: 'KNOWLEDGE_RECORD_NOT_FOUND',
          message: 'Knowledge record not found',
          statusCode: 404,
        });
      }
      assertWorkspaceAllowed(client, record.workspaceId);
      assertProjectAllowed(client, record.projectId);
      const truncated = truncateContent(record.contentMarkdown);
      await auditKnowledgeView({
        database: app.database,
        organizationId: client.organizationId,
        actorType: 'api_client',
        actorId: client.id,
        recordId: record.id,
        workspaceId: record.workspaceId,
        projectId: record.projectId,
        systemId: record.systemId,
        slug: record.slug,
        via: 'mcp',
        ipAddress,
      });
      const reviewedByUser = await resolveReviewedByUser(app.database, record);
      const mediaRows = await listWorkspaceMedia(app.database, {
        workspaceId: record.workspaceId,
        knowledgeRecordId: record.id,
        limit: 50,
      });
      return {
        knowledgeRecord: {
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
          contentMarkdown: truncated.content,
          contentTruncated: truncated.truncated,
          currentVersionNumber: record.currentVersionNumber,
          verifiedAt: record.verifiedAt?.toISOString() ?? null,
          lastValidatedAt: record.lastValidatedAt?.toISOString() ?? null,
          reviewedBy: record.reviewedBy,
          reviewedByUser,
          updatedAt: record.updatedAt.toISOString(),
          media: mediaRows.map(toPublicMedia),
        },
      };
    },

    async listRecordMetadata() {
      return buildKnowledgeRecordMetadata();
    },

    async getRecordProvenance({ recordId }) {
      const [record] = await app.database.db
        .select()
        .from(knowledgeRecords)
        .where(and(eq(knowledgeRecords.id, recordId), isNull(knowledgeRecords.archivedAt)))
        .limit(1);
      if (!record) {
        throw new AppError({
          code: 'KNOWLEDGE_RECORD_NOT_FOUND',
          message: 'Knowledge record not found',
          statusCode: 404,
        });
      }
      assertWorkspaceAllowed(client, record.workspaceId);
      assertProjectAllowed(client, record.projectId);
      const sources = await app.database.db
        .select()
        .from(knowledgeSources)
        .where(eq(knowledgeSources.knowledgeRecordId, record.id));
      const reviewedByUser = await resolveReviewedByUser(app.database, record);
      return {
        recordId: record.id,
        title: record.title,
        lifecycleStatus: record.lifecycleStatus,
        sourceOfTruthMode: record.sourceOfTruthMode,
        createdBy: record.createdBy,
        reviewedBy: record.reviewedBy,
        reviewedByUser,
        verifiedAt: record.verifiedAt?.toISOString() ?? null,
        lastValidatedAt: record.lastValidatedAt?.toISOString() ?? null,
        sources: sources.map((source) => ({
          sourceType: source.sourceType,
          sourceProvider: source.sourceProvider,
          sourceReference: source.sourceReference,
          sourceTitle: source.sourceTitle,
          sourceUri: source.sourceUri,
          generatedByModel: source.generatedByModel,
          sourceCreatedAt: source.sourceCreatedAt?.toISOString() ?? null,
        })),
      };
    },

    async listRecordTranslations({ recordId }) {
      const [record] = await app.database.db
        .select()
        .from(knowledgeRecords)
        .where(and(eq(knowledgeRecords.id, recordId), isNull(knowledgeRecords.archivedAt)))
        .limit(1);
      if (!record) {
        throw new AppError({
          code: 'KNOWLEDGE_RECORD_NOT_FOUND',
          message: 'Knowledge record not found',
          statusCode: 404,
        });
      }
      assertWorkspaceAllowed(client, record.workspaceId);
      assertProjectAllowed(client, record.projectId);
      return listRecordTranslations(app, recordId);
    },

    async createRecordTranslation(input) {
      const [record] = await app.database.db
        .select()
        .from(knowledgeRecords)
        .where(and(eq(knowledgeRecords.id, input.recordId), isNull(knowledgeRecords.archivedAt)))
        .limit(1);
      if (!record) {
        throw new AppError({
          code: 'KNOWLEDGE_RECORD_NOT_FOUND',
          message: 'Knowledge record not found',
          statusCode: 404,
        });
      }
      assertWriteWorkspaceAllowed(client, record.workspaceId);
      assertProjectAllowed(client, record.projectId);
      const actingUserId = requireActingUserId(client);
      const result = await createRecordTranslation(
        app,
        input.recordId,
        {
          language: input.language,
          slug: input.slug,
          translateWithAi: input.translateWithAi,
          title: input.title,
          summary: input.summary,
          contentMarkdown: input.contentMarkdown,
        },
        {
          actorType: 'api_client',
          actorId: client.id,
          userId: actingUserId,
        },
        ipAddress,
      );
      return {
        knowledgeRecord: {
          id: result.knowledgeRecord.id,
          workspaceId: result.knowledgeRecord.workspaceId,
          title: result.knowledgeRecord.title,
          slug: result.knowledgeRecord.slug,
          recordType: result.knowledgeRecord.recordType,
          language: result.knowledgeRecord.language,
          translationGroupId: result.knowledgeRecord.translationGroupId,
          lifecycleStatus: result.knowledgeRecord.lifecycleStatus,
          sourceOfTruthMode: result.knowledgeRecord.sourceOfTruthMode,
          currentVersionNumber: result.knowledgeRecord.currentVersionNumber,
          projectId: result.knowledgeRecord.projectId,
          systemId: result.knowledgeRecord.systemId,
        },
      };
    },

    async createKnowledgeRecord(input) {
      assertWriteWorkspaceAllowed(client, input.workspaceId);
      if (input.projectId) {
        assertProjectAllowed(client, input.projectId);
      }
      const actingUserId = requireActingUserId(client);
      const recordType = recordTypeSchema.parse(input.recordType);

      const result = await createKnowledgeRecord(
        app,
        {
          workspaceId: input.workspaceId,
          title: input.title,
          recordType,
          contentMarkdown: input.contentMarkdown,
          summary: input.summary,
          slug: input.slug,
          projectId: input.projectId ?? null,
          systemId: input.systemId ?? null,
          tags: input.tags,
          language: input.language,
          translationGroupId: input.translationGroupId,
          lifecycleStatus: 'draft',
          sourceOfTruthMode: 'ai_generated_draft',
          source: {
            sourceType: 'conversation',
            sourceProvider: 'mcp',
            sourceTitle: input.sourceTitle ?? 'Created via MCP',
            generatedByModel: input.generatedByModel ?? null,
          },
        },
        {
          actorType: 'api_client',
          actorId: client.id,
          userId: actingUserId,
        },
        ipAddress,
      );

      return {
        knowledgeRecord: {
          id: result.knowledgeRecord.id,
          workspaceId: result.knowledgeRecord.workspaceId,
          title: result.knowledgeRecord.title,
          slug: result.knowledgeRecord.slug,
          recordType: result.knowledgeRecord.recordType,
          lifecycleStatus: result.knowledgeRecord.lifecycleStatus,
          sourceOfTruthMode: result.knowledgeRecord.sourceOfTruthMode,
          currentVersionNumber: result.knowledgeRecord.currentVersionNumber,
          projectId: result.knowledgeRecord.projectId,
          systemId: result.knowledgeRecord.systemId,
        },
      };
    },

    async updateKnowledgeRecord(input) {
      const actingUserId = requireActingUserId(client);

      const [existing] = await app.database.db
        .select()
        .from(knowledgeRecords)
        .where(and(eq(knowledgeRecords.id, input.recordId), isNull(knowledgeRecords.archivedAt)))
        .limit(1);
      if (!existing) {
        throw new AppError({
          code: 'KNOWLEDGE_RECORD_NOT_FOUND',
          message: 'Knowledge record not found',
          statusCode: 404,
        });
      }

      assertWriteWorkspaceAllowed(client, existing.workspaceId);
      const nextProjectId =
        input.projectId === undefined ? existing.projectId : input.projectId;
      assertProjectAllowed(client, nextProjectId);

      const recordType =
        input.recordType === undefined
          ? undefined
          : recordTypeSchema.parse(input.recordType);

      const result = await updateKnowledgeRecord(
        app,
        input.recordId,
        {
          title: input.title,
          summary: input.summary,
          recordType,
          contentMarkdown: input.contentMarkdown,
          projectId: input.projectId,
          systemId: input.systemId,
          tags: input.tags,
          language: input.language,
          translationGroupId: input.translationGroupId,
          changeMessage: input.changeMessage,
          lifecycleStatus: 'draft',
          sourceOfTruthMode: 'ai_generated_draft',
          source:
            input.generatedByModel !== undefined || input.sourceTitle !== undefined
              ? {
                  sourceType: 'conversation',
                  sourceProvider: 'mcp',
                  sourceTitle: input.sourceTitle ?? 'Updated via MCP',
                  generatedByModel: input.generatedByModel ?? null,
                }
              : undefined,
        },
        {
          actorType: 'api_client',
          actorId: client.id,
          userId: actingUserId,
        },
        ipAddress,
      );

      return {
        knowledgeRecord: {
          id: result.knowledgeRecord.id,
          workspaceId: result.knowledgeRecord.workspaceId,
          title: result.knowledgeRecord.title,
          slug: result.knowledgeRecord.slug,
          recordType: result.knowledgeRecord.recordType,
          lifecycleStatus: result.knowledgeRecord.lifecycleStatus,
          sourceOfTruthMode: result.knowledgeRecord.sourceOfTruthMode,
          currentVersionNumber: result.knowledgeRecord.currentVersionNumber,
          projectId: result.knowledgeRecord.projectId,
          systemId: result.knowledgeRecord.systemId,
          versioned: result.shouldVersion,
        },
      };
    },

    async uploadWorkspaceMedia(input) {
      assertWriteWorkspaceAllowed(client, input.workspaceId);
      const actingUserId = requireActingUserId(client);

      if (input.insertIntoRecord && !input.knowledgeRecordId) {
        throw new AppError({
          code: 'VALIDATION_ERROR',
          message: 'insertIntoRecord requires knowledgeRecordId',
          statusCode: 400,
        });
      }

      let buffer: Buffer;
      try {
        buffer = Buffer.from(input.contentBase64, 'base64');
      } catch {
        throw new AppError({
          code: 'MEDIA_INVALID_BASE64',
          message: 'contentBase64 is not valid base64',
          statusCode: 400,
        });
      }
      if (buffer.byteLength === 0) {
        throw new AppError({
          code: 'MEDIA_INVALID_BASE64',
          message: 'Decoded media is empty',
          statusCode: 400,
        });
      }

      const { store: blobStore } = await app.getBlobStore();
      const row = await createWorkspaceMedia(app.database, {
        workspaceId: input.workspaceId,
        knowledgeRecordId: input.knowledgeRecordId ?? null,
        contentType: input.contentType,
        buffer,
        originalFilename: input.filename ?? null,
        altText: input.alt ?? null,
        createdBy: actingUserId,
        uploadDir: app.env.MEDIA_UPLOAD_DIR,
        maxBytes: app.env.MEDIA_MAX_BYTES,
        blobStore,
      });
      const media = toPublicMedia(row);

      await writeAuditEvent(app.database, {
        organizationId: client.organizationId,
        actorType: 'api_client',
        actorId: client.id,
        action: 'media.upload',
        entityType: 'workspace_media',
        entityId: row.id,
        metadata: {
          workspaceId: input.workspaceId,
          knowledgeRecordId: row.knowledgeRecordId,
          contentType: row.contentType,
          byteSize: row.byteSize,
          insertIntoRecord: Boolean(input.insertIntoRecord),
          via: 'mcp',
        },
        ipAddress: ipAddress ?? null,
      });

      if (!input.insertIntoRecord || !input.knowledgeRecordId) {
        return {
          media,
          insertedIntoRecord: false,
          hint: 'Paste media.markdownSnippet into create_knowledge_record or update_knowledge_record contentMarkdown. Or re-call with insertIntoRecord=true and knowledgeRecordId. ChatGPT Actions: prefer begin/append/finalize_workspace_media_upload for large base64.',
        };
      }

      return embedMediaIntoRecord(
        app,
        client,
        actingUserId,
        media,
        input.knowledgeRecordId,
        input.workspaceId,
        ipAddress,
      );
    },

    async beginWorkspaceMediaUpload(input) {
      assertWriteWorkspaceAllowed(client, input.workspaceId);
      requireActingUserId(client);

      if (input.insertIntoRecord && !input.knowledgeRecordId) {
        throw new AppError({
          code: 'VALIDATION_ERROR',
          message: 'insertIntoRecord requires knowledgeRecordId',
          statusCode: 400,
        });
      }

      const started = await beginMediaUploadSession(app.redis, {
        clientId: client.id,
        workspaceId: input.workspaceId,
        contentType: input.contentType,
        filename: input.filename ?? null,
        alt: input.alt ?? null,
        knowledgeRecordId: input.knowledgeRecordId ?? null,
        insertIntoRecord: input.insertIntoRecord,
      });

      return {
        ...started,
        hint: `ChatGPT: split the raw base64 into ~${started.recommendedChunkChars}-char chunks (max ${started.maxChunkChars}). Call append_workspace_media_upload for each chunk, then finalize_workspace_media_upload.`,
      };
    },

    async appendWorkspaceMediaUpload(input) {
      requireActingUserId(client);
      return appendMediaUploadChunk(app.redis, {
        uploadId: input.uploadId,
        clientId: client.id,
        chunkBase64: input.chunkBase64,
        index: input.index,
      });
    },

    async finalizeWorkspaceMediaUpload(input) {
      const actingUserId = requireActingUserId(client);
      const session = await takeMediaUploadSession(
        app.redis,
        input.uploadId,
        client.id,
      );
      assertWriteWorkspaceAllowed(client, session.workspaceId);

      if (session.chunks.length === 0) {
        throw new AppError({
          code: 'VALIDATION_ERROR',
          message: 'No chunks uploaded; call append_workspace_media_upload first',
          statusCode: 400,
        });
      }

      const contentBase64 = session.chunks.join('');
      let buffer: Buffer;
      try {
        buffer = Buffer.from(contentBase64, 'base64');
      } catch {
        throw new AppError({
          code: 'MEDIA_INVALID_BASE64',
          message: 'Assembled contentBase64 is not valid base64',
          statusCode: 400,
        });
      }
      if (buffer.byteLength === 0) {
        throw new AppError({
          code: 'MEDIA_INVALID_BASE64',
          message: 'Decoded media is empty',
          statusCode: 400,
        });
      }

      const { store: blobStore } = await app.getBlobStore();
      const row = await createWorkspaceMedia(app.database, {
        workspaceId: session.workspaceId,
        knowledgeRecordId: session.knowledgeRecordId,
        contentType: session.contentType,
        buffer,
        originalFilename: session.filename,
        altText: session.alt,
        createdBy: actingUserId,
        uploadDir: app.env.MEDIA_UPLOAD_DIR,
        maxBytes: app.env.MEDIA_MAX_BYTES,
        blobStore,
      });
      const media = toPublicMedia(row);

      await writeAuditEvent(app.database, {
        organizationId: client.organizationId,
        actorType: 'api_client',
        actorId: client.id,
        action: 'media.upload',
        entityType: 'workspace_media',
        entityId: row.id,
        metadata: {
          workspaceId: session.workspaceId,
          knowledgeRecordId: row.knowledgeRecordId,
          contentType: row.contentType,
          byteSize: row.byteSize,
          insertIntoRecord: session.insertIntoRecord,
          chunkCount: session.chunks.length,
          via: 'mcp_chunked',
        },
        ipAddress: ipAddress ?? null,
      });

      if (!session.insertIntoRecord || !session.knowledgeRecordId) {
        return {
          media,
          insertedIntoRecord: false,
          chunkCount: session.chunks.length,
          totalBase64Chars: session.totalBase64Chars,
          hint: 'Paste media.markdownSnippet into create/update, or begin again with insertIntoRecord=true and knowledgeRecordId.',
        };
      }

      const embedded = await embedMediaIntoRecord(
        app,
        client,
        actingUserId,
        media,
        session.knowledgeRecordId,
        session.workspaceId,
        ipAddress,
      );
      return {
        ...embedded,
        chunkCount: session.chunks.length,
        totalBase64Chars: session.totalBase64Chars,
      };
    },

    async listWorkspaceMedia(input) {
      assertWorkspaceAllowed(client, input.workspaceId);
      const rows = await listWorkspaceMedia(app.database, {
        workspaceId: input.workspaceId,
        knowledgeRecordId: input.knowledgeRecordId,
        limit: input.limit,
      });
      return { media: rows.map(toPublicMedia) };
    },

    async deleteWorkspaceMedia(input) {
      const existing = await getWorkspaceMediaById(app.database, input.mediaId);
      if (!existing) {
        throw new AppError({
          code: 'MEDIA_NOT_FOUND',
          message: 'Media not found',
          statusCode: 404,
        });
      }
      assertWriteWorkspaceAllowed(client, existing.workspaceId);
      requireActingUserId(client);

      const { store: blobStore } = await app.getBlobStore();
      const archived = await archiveWorkspaceMedia(app.database, {
        mediaId: input.mediaId,
        uploadDir: app.env.MEDIA_UPLOAD_DIR,
        blobStore,
      });

      await writeAuditEvent(app.database, {
        organizationId: client.organizationId,
        actorType: 'api_client',
        actorId: client.id,
        action: 'media.delete',
        entityType: 'workspace_media',
        entityId: archived.id,
        metadata: { workspaceId: archived.workspaceId, via: 'mcp' },
        ipAddress: ipAddress ?? null,
      });

      return { media: toPublicMedia(archived), mediaId: archived.id };
    },

    async getPlatformStatus() {
      const dump = await buildSupportDump(app);
      await writeAuditEvent(app.database, {
        organizationId: client.organizationId,
        actorType: 'api_client',
        actorId: client.id,
        action: 'platform.status',
        entityType: 'monitoring',
        entityId: 'platform-status',
        metadata: { via: 'mcp', byteLength: JSON.stringify(dump).length },
        ipAddress: ipAddress ?? null,
      });
      return dump;
    },

    async listProjectMilestones(input) {
      await requirePmProject(app, client, input.projectId);
      return {
        milestones: await listMilestones(app.database, input.projectId, {
          includeArchived: input.includeArchived,
        }),
      };
    },

    async listProjectTasks(input) {
      await requirePmProject(app, client, input.projectId);
      const milestoneId = input.unassignedMilestone
        ? null
        : input.milestoneId;
      return {
        tasks: await listTasks(app.database, input.projectId, {
          milestoneId,
          includeArchived: input.includeArchived,
        }),
      };
    },

    async getProjectTask(input) {
      const task = await getTask(app.database, input.taskId);
      await requirePmProject(app, client, task.projectId);
      return { task };
    },

    async createProjectMilestone(input) {
      const actingUserId = requireActingUserId(client);
      const project = await requirePmProject(app, client, input.projectId, {
        forWrite: true,
      });
      const milestone = await createMilestone(app.database, {
        projectId: project.id,
        title: input.title,
        description: input.description,
        status: input.status
          ? milestoneStatusSchema.parse(input.status)
          : undefined,
        targetDate: input.targetDate,
        sortOrder: input.sortOrder,
      });
      await writeAuditEvent(app.database, {
        organizationId: client.organizationId,
        actorType: 'api_client',
        actorId: client.id,
        action: 'project.milestone_created',
        entityType: 'project_milestone',
        entityId: milestone.id,
        metadata: {
          projectId: project.id,
          title: milestone.title,
          via: 'mcp',
          actingUserId,
        },
        ipAddress: ipAddress ?? null,
      });
      return { milestone };
    },

    async updateProjectMilestone(input) {
      const actingUserId = requireActingUserId(client);
      const existing = await getMilestone(app.database, input.milestoneId);
      const project = await requirePmProject(app, client, existing.projectId, {
        forWrite: true,
      });
      const milestone = await updateMilestone(app.database, input.milestoneId, {
        title: input.title,
        description: input.description,
        status: input.status
          ? milestoneStatusSchema.parse(input.status)
          : undefined,
        targetDate: input.targetDate,
        sortOrder: input.sortOrder,
        archived: input.archived,
      });
      await writeAuditEvent(app.database, {
        organizationId: client.organizationId,
        actorType: 'api_client',
        actorId: client.id,
        action: 'project.milestone_updated',
        entityType: 'project_milestone',
        entityId: milestone.id,
        metadata: { projectId: project.id, via: 'mcp', actingUserId },
        ipAddress: ipAddress ?? null,
      });
      return { milestone };
    },

    async createProjectTask(input) {
      const actingUserId = requireActingUserId(client);
      const project = await requirePmProject(app, client, input.projectId, {
        forWrite: true,
      });
      const task = await createTask(app.database, {
        projectId: project.id,
        workspaceId: project.workspaceId,
        title: input.title,
        description: input.description,
        status: input.status ? taskStatusSchema.parse(input.status) : undefined,
        dueDate: input.dueDate,
        milestoneId: input.milestoneId,
        sortOrder: input.sortOrder,
        createdBy: actingUserId,
        raci: input.raci?.map((entry) => ({
          userId: entry.userId,
          role: raciRoleSchema.parse(entry.role),
        })),
      });
      await writeAuditEvent(app.database, {
        organizationId: client.organizationId,
        actorType: 'api_client',
        actorId: client.id,
        action: 'project.task_created',
        entityType: 'project_task',
        entityId: task.id,
        metadata: {
          projectId: project.id,
          title: task.title,
          via: 'mcp',
          actingUserId,
        },
        ipAddress: ipAddress ?? null,
      });
      return { task };
    },

    async updateProjectTask(input) {
      const actingUserId = requireActingUserId(client);
      const existing = await getTask(app.database, input.taskId);
      const project = await requirePmProject(app, client, existing.projectId, {
        forWrite: true,
      });
      const task = await updateTask(app.database, input.taskId, {
        title: input.title,
        description: input.description,
        status: input.status ? taskStatusSchema.parse(input.status) : undefined,
        dueDate: input.dueDate,
        milestoneId: input.milestoneId,
        sortOrder: input.sortOrder,
        archived: input.archived,
      });
      await writeAuditEvent(app.database, {
        organizationId: client.organizationId,
        actorType: 'api_client',
        actorId: client.id,
        action: 'project.task_updated',
        entityType: 'project_task',
        entityId: task.id,
        metadata: { projectId: project.id, via: 'mcp', actingUserId },
        ipAddress: ipAddress ?? null,
      });
      return { task };
    },

    async setProjectTaskRaci(input) {
      const actingUserId = requireActingUserId(client);
      const existing = await getTask(app.database, input.taskId);
      const project = await requirePmProject(app, client, existing.projectId, {
        forWrite: true,
      });
      const raci = await replaceTaskRaci(app.database, {
        taskId: input.taskId,
        workspaceId: project.workspaceId,
        entries: input.entries.map((entry) => ({
          userId: entry.userId,
          role: raciRoleSchema.parse(entry.role),
        })),
      });
      const task = await getTask(app.database, input.taskId);
      await writeAuditEvent(app.database, {
        organizationId: client.organizationId,
        actorType: 'api_client',
        actorId: client.id,
        action: 'project.task_raci_set',
        entityType: 'project_task',
        entityId: task.id,
        metadata: {
          projectId: project.id,
          entries: input.entries,
          via: 'mcp',
          actingUserId,
        },
        ipAddress: ipAddress ?? null,
      });
      return { task, raci };
    },

    async onToolCall(toolName, ok, context) {
      await writeAuditEvent(app.database, {
        organizationId: client.organizationId,
        actorType: 'api_client',
        actorId: client.id,
        action: ok ? 'mcp.tool_call' : 'mcp.tool_error',
        entityType: 'mcp_tool',
        entityId: toolName,
        metadata: {
          clientName: client.name,
          toolName,
          ok,
          ...(context?.recordId ? { recordId: context.recordId } : {}),
          ...(context?.projectId ? { projectId: context.projectId } : {}),
          ...(context?.systemId ? { systemId: context.systemId } : {}),
          ...(context?.workspaceId ? { workspaceId: context.workspaceId } : {}),
          ...(context?.mediaId ? { mediaId: context.mediaId } : {}),
        },
        ipAddress: ipAddress ?? null,
      });
    },
  };
}
