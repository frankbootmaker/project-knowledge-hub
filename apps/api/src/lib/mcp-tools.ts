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
  recordTypeSchema,
} from '@project-knowledge-hub/domain';
import {
  truncateContent,
  type McpClientContext,
  type McpToolHandlers,
} from '@project-knowledge-hub/mcp';
import { runSearch } from './search-service.js';
import { writeAuditEvent } from './identity.js';
import { createKnowledgeRecord, updateKnowledgeRecord } from './knowledge-records-service.js';

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
      message: 'API client is missing actingUserId required for knowledge:write',
      statusCode: 403,
    });
  }
  return client.actingUserId;
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

    async listKnowledgeRecords({ workspaceId, projectId, systemId, limit }) {
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
        recordTypes: input.recordTypes as never,
        lifecycleStatuses: input.statuses as never,
        limit: input.limit,
        mode: input.mode === 'hybrid' ? 'hybrid' : 'fts',
        verifiedOnly: input.statuses?.every((status) =>
          ['verified', 'current'].includes(status),
        ),
      });
      return {
        ...result,
        results: result.results.filter((item) => {
          try {
            assertProjectAllowed(client, item.projectId);
            return true;
          } catch {
            return false;
          }
        }),
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
          updatedAt: record.updatedAt.toISOString(),
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
      return {
        recordId: record.id,
        title: record.title,
        lifecycleStatus: record.lifecycleStatus,
        sourceOfTruthMode: record.sourceOfTruthMode,
        createdBy: record.createdBy,
        reviewedBy: record.reviewedBy,
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
        },
        ipAddress: ipAddress ?? null,
      });
    },
  };
}
