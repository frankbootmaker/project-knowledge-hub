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
  changeDeliveryEntityTypeSchema,
  changeKindSchema,
  changeStatusSchema,
  deliveryLinkEntityTypeSchema,
  epicStatusSchema,
  milestoneStatusSchema,
  aiCostModeSchema,
  projectCurrencySchema,
  projectStakeholderRoleSchema,
  raciRoleSchema,
  stakeholderEngagementTypeSchema,
  raidKindSchema,
  raidSeveritySchema,
  raidStatusSchema,
  recordTypeSchema,
  taskStatusSchema,
  userStoryStatusSchema,
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
import {
  addTaskComment,
  createEpic,
  createUserStory,
  getEpic,
  getUserStory,
  handoffTask,
  listEpics,
  listTaskActivities,
  listUserStories,
  updateEpic,
  updateUserStory,
} from './project-agile.js';
import {
  deleteProjectStakeholder,
  getRosterStakeholder,
  listProjectStakeholders,
  updateAiAssistantCost,
  updateProjectStakeholder,
  upsertProjectStakeholder,
} from './project-stakeholders.js';
import { getProjectResourceUtilization } from './project-resource-utilization.js';
import {
  createRaidItem,
  getRaidItem,
  listRaidItems,
  setRaidTaskLinks,
  transferRaidItem,
  updateRaidItem,
} from './project-raid.js';
import {
  assertUniqueKeyPrefix,
  resolveEntityId,
} from './project-issue-keys.js';
import {
  assertPinnedKnowledgeRecord,
  listInitialStakeholders,
  loadPinnedRecords,
  setInitialStakeholders,
} from './project-baseline.js';
import {
  createChangeItem,
  getChangeItem,
  listChangeItems,
  updateChangeItem,
} from './project-changes.js';
import {
  getProjectBudgetSummary,
  parseBudgetAmount,
  parseHours,
  parseTokenRate,
  upsertProjectCostSnapshot,
} from './project-budget.js';
import {
  getKnowledgeRecordProjectContext,
  listDeliveryLinksForRecord,
  setDeliveryLinksForRecord,
} from './knowledge-delivery-links.js';

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
          keyPrefix: row.keyPrefix,
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
      const pinned = await loadPinnedRecords(app.database, [
        project.charterRecordId,
        project.initialPlanRecordId,
      ]);
      return {
        project: {
          id: project.id,
          workspaceId: project.workspaceId,
          name: project.name,
          slug: project.slug,
          status: project.status,
          summary: project.summary,
          description: project.description,
          startDate: project.startDate,
          endDate: project.endDate,
          charterRecordId: project.charterRecordId,
          charterRecord: project.charterRecordId
            ? pinned.get(project.charterRecordId) ?? null
            : null,
          initialPlanRecordId: project.initialPlanRecordId,
          initialPlanRecord: project.initialPlanRecordId
            ? pinned.get(project.initialPlanRecordId) ?? null
            : null,
          currency: projectCurrencySchema.parse(project.currency),
          initialBudget: project.initialBudget,
          approvedBudget: project.approvedBudget,
          keyPrefix: project.keyPrefix,
        },
      };
    },

    async updateProjectBaseline(input: {
      projectId: string;
      startDate?: string | null;
      endDate?: string | null;
      charterRecordId?: string | null;
      initialPlanRecordId?: string | null;
      currency?: string;
      initialBudget?: number | string | null;
      approvedBudget?: number | string | null;
      keyPrefix?: string;
    }) {
      const actingUserId = requireActingUserId(client);
      const project = await requirePmProject(app, client, input.projectId, {
        forWrite: true,
      });
      const nextCharterId =
        input.charterRecordId === undefined
          ? project.charterRecordId
          : input.charterRecordId;
      const nextPlanId =
        input.initialPlanRecordId === undefined
          ? project.initialPlanRecordId
          : input.initialPlanRecordId;
      if (nextCharterId) {
        await assertPinnedKnowledgeRecord(app.database, {
          recordId: nextCharterId,
          projectId: project.id,
          expectedTypes: ['project-charter'],
        });
      }
      if (nextPlanId) {
        await assertPinnedKnowledgeRecord(app.database, {
          recordId: nextPlanId,
          projectId: project.id,
          expectedTypes: ['plan'],
        });
      }
      const nextKeyPrefix =
        input.keyPrefix === undefined
          ? project.keyPrefix
          : await assertUniqueKeyPrefix(app.database, {
              workspaceId: project.workspaceId,
              keyPrefix: input.keyPrefix,
              excludeProjectId: project.id,
            });
      const [updated] = await app.database.db
        .update(projects)
        .set({
          startDate:
            input.startDate === undefined ? project.startDate : input.startDate,
          endDate:
            input.endDate === undefined ? project.endDate : input.endDate,
          charterRecordId: nextCharterId,
          initialPlanRecordId: nextPlanId,
          currency: input.currency
            ? projectCurrencySchema.parse(input.currency)
            : project.currency,
          initialBudget:
            input.initialBudget === undefined
              ? project.initialBudget
              : parseBudgetAmount(input.initialBudget) ?? null,
          approvedBudget:
            input.approvedBudget === undefined
              ? project.approvedBudget
              : parseBudgetAmount(input.approvedBudget) ?? null,
          keyPrefix: nextKeyPrefix,
          updatedAt: new Date(),
        })
        .where(eq(projects.id, project.id))
        .returning();
      if (!updated) {
        throw new AppError({
          code: 'PROJECT_NOT_FOUND',
          message: 'Project not found',
          statusCode: 404,
        });
      }
      if (
        input.currency !== undefined ||
        input.initialBudget !== undefined ||
        input.approvedBudget !== undefined
      ) {
        await upsertProjectCostSnapshot(app.database, project.id);
      }
      await writeAuditEvent(app.database, {
        organizationId: client.organizationId,
        actorType: 'api_client',
        actorId: client.id,
        action: 'project.baseline_updated',
        entityType: 'project',
        entityId: project.id,
        metadata: { via: 'mcp', actingUserId },
        ipAddress: ipAddress ?? null,
      });
      const pinned = await loadPinnedRecords(app.database, [
        updated.charterRecordId,
        updated.initialPlanRecordId,
      ]);
      return {
        project: {
          id: updated.id,
          workspaceId: updated.workspaceId,
          name: updated.name,
          slug: updated.slug,
          status: updated.status,
          summary: updated.summary,
          description: updated.description,
          startDate: updated.startDate,
          endDate: updated.endDate,
          charterRecordId: updated.charterRecordId,
          charterRecord: updated.charterRecordId
            ? pinned.get(updated.charterRecordId) ?? null
            : null,
          initialPlanRecordId: updated.initialPlanRecordId,
          initialPlanRecord: updated.initialPlanRecordId
            ? pinned.get(updated.initialPlanRecordId) ?? null
            : null,
          currency: projectCurrencySchema.parse(updated.currency),
          initialBudget: updated.initialBudget,
          approvedBudget: updated.approvedBudget,
          keyPrefix: updated.keyPrefix,
        },
      };
    },

    async getProjectBudgetSummary(input: { projectId: string }) {
      await requirePmProject(app, client, input.projectId);
      return {
        budget: await getProjectBudgetSummary(app.database, input.projectId),
      };
    },

    async getProjectResourceUtilization(input: {
      projectId: string;
      view?: 'planned' | 'burn' | 'combined';
    }) {
      await requirePmProject(app, client, input.projectId);
      return {
        utilization: await getProjectResourceUtilization(
          app.database,
          input.projectId,
          input.view ?? 'planned',
        ),
      };
    },

    async listProjectInitialStakeholders(input: { projectId: string }) {
      await requirePmProject(app, client, input.projectId);
      return {
        initialStakeholders: await listInitialStakeholders(
          app.database,
          input.projectId,
        ),
      };
    },

    async setProjectInitialStakeholders(input: {
      projectId: string;
      stakeholders: Array<{
        userId: string;
        projectRole?: string;
        sortOrder?: number;
      }>;
    }) {
      const actingUserId = requireActingUserId(client);
      const project = await requirePmProject(app, client, input.projectId, {
        forWrite: true,
      });
      const initialStakeholders = await setInitialStakeholders(app.database, {
        projectId: project.id,
        workspaceId: project.workspaceId,
        stakeholders: input.stakeholders.map((row) => ({
          userId: row.userId,
          projectRole: row.projectRole
            ? projectStakeholderRoleSchema.parse(row.projectRole)
            : undefined,
          sortOrder: row.sortOrder,
        })),
      });
      await writeAuditEvent(app.database, {
        organizationId: client.organizationId,
        actorType: 'api_client',
        actorId: client.id,
        action: 'project.initial_stakeholders_set',
        entityType: 'project',
        entityId: project.id,
        metadata: {
          count: initialStakeholders.length,
          via: 'mcp',
          actingUserId,
        },
        ipAddress: ipAddress ?? null,
      });
      return { initialStakeholders };
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
      let milestoneId: string | null | undefined = input.unassignedMilestone
        ? null
        : input.milestoneId;
      if (typeof milestoneId === 'string') {
        milestoneId = await resolveEntityId(app.database, {
          entityType: 'milestone',
          idOrKey: milestoneId,
          projectId: input.projectId,
        });
      }
      return {
        tasks: await listTasks(app.database, input.projectId, {
          milestoneId,
          includeArchived: input.includeArchived,
        }),
      };
    },

    async getProjectTask(input) {
      const taskId = await resolveEntityId(app.database, {
        entityType: 'task',
        idOrKey: input.taskId,
      });
      const task = await getTask(app.database, taskId);
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
        startDate: input.startDate,
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
      const milestoneId = await resolveEntityId(app.database, {
        entityType: 'milestone',
        idOrKey: input.milestoneId,
      });
      const existing = await getMilestone(app.database, milestoneId);
      const project = await requirePmProject(app, client, existing.projectId, {
        forWrite: true,
      });
      const milestone = await updateMilestone(app.database, milestoneId, {
        title: input.title,
        description: input.description,
        status: input.status
          ? milestoneStatusSchema.parse(input.status)
          : undefined,
        startDate: input.startDate,
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
      const milestoneId =
        input.milestoneId == null
          ? input.milestoneId
          : await resolveEntityId(app.database, {
              entityType: 'milestone',
              idOrKey: input.milestoneId,
              projectId: project.id,
            });
      const userStoryId =
        input.userStoryId == null
          ? input.userStoryId
          : await resolveEntityId(app.database, {
              entityType: 'user_story',
              idOrKey: input.userStoryId,
              projectId: project.id,
            });
      const task = await createTask(app.database, {
        projectId: project.id,
        workspaceId: project.workspaceId,
        title: input.title,
        description: input.description,
        status: input.status ? taskStatusSchema.parse(input.status) : undefined,
        dueDate: input.dueDate,
        forecastHours:
          input.forecastHours === undefined
            ? undefined
            : parseHours(input.forecastHours) ?? null,
        actualHours:
          input.actualHours === undefined
            ? undefined
            : parseHours(input.actualHours) ?? null,
        tokensUsed: input.tokensUsed,
        aiSystemId: input.aiSystemId,
        milestoneId,
        userStoryId,
        currentOwnerUserId: input.currentOwnerUserId,
        sortOrder: input.sortOrder,
        createdBy: actingUserId,
        raci: input.raci?.map((entry) => ({
          userId: entry.userId,
          role: raciRoleSchema.parse(entry.role),
        })),
      });
      if (
        input.forecastHours !== undefined ||
        input.actualHours !== undefined ||
        input.tokensUsed !== undefined ||
        input.aiSystemId !== undefined
      ) {
        await upsertProjectCostSnapshot(app.database, project.id);
      }
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
      const taskId = await resolveEntityId(app.database, {
        entityType: 'task',
        idOrKey: input.taskId,
      });
      const existing = await getTask(app.database, taskId);
      const project = await requirePmProject(app, client, existing.projectId, {
        forWrite: true,
      });
      const milestoneId =
        input.milestoneId === undefined || input.milestoneId === null
          ? input.milestoneId
          : await resolveEntityId(app.database, {
              entityType: 'milestone',
              idOrKey: input.milestoneId,
              projectId: project.id,
            });
      const userStoryId =
        input.userStoryId === undefined || input.userStoryId === null
          ? input.userStoryId
          : await resolveEntityId(app.database, {
              entityType: 'user_story',
              idOrKey: input.userStoryId,
              projectId: project.id,
            });
      const task = await updateTask(app.database, taskId, {
        title: input.title,
        description: input.description,
        status: input.status ? taskStatusSchema.parse(input.status) : undefined,
        dueDate: input.dueDate,
        forecastHours:
          input.forecastHours === undefined
            ? undefined
            : parseHours(input.forecastHours) ?? null,
        actualHours:
          input.actualHours === undefined
            ? undefined
            : parseHours(input.actualHours) ?? null,
        tokensUsed: input.tokensUsed,
        aiSystemId: input.aiSystemId,
        milestoneId,
        userStoryId,
        currentOwnerUserId: input.currentOwnerUserId,
        sortOrder: input.sortOrder,
        archived: input.archived,
        actorUserId: actingUserId,
        workspaceId: project.workspaceId,
      });
      if (
        input.forecastHours !== undefined ||
        input.actualHours !== undefined ||
        input.tokensUsed !== undefined ||
        input.aiSystemId !== undefined
      ) {
        await upsertProjectCostSnapshot(app.database, project.id);
      }
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

    async reportProjectTaskAiUsage(input) {
      const actingUserId = requireActingUserId(client);
      const taskId = await resolveEntityId(app.database, {
        entityType: 'task',
        idOrKey: input.taskId,
      });
      const existing = await getTask(app.database, taskId);
      const project = await requirePmProject(app, client, existing.projectId, {
        forWrite: true,
      });
      const task = await updateTask(app.database, taskId, {
        tokensUsed: input.tokensUsed,
        aiSystemId:
          input.aiSystemId === undefined
            ? existing.aiSystemId
            : input.aiSystemId,
        actorUserId: actingUserId,
        workspaceId: project.workspaceId,
      });
      await upsertProjectCostSnapshot(app.database, project.id);
      await writeAuditEvent(app.database, {
        organizationId: client.organizationId,
        actorType: 'api_client',
        actorId: client.id,
        action: 'project.task_ai_usage_reported',
        entityType: 'project_task',
        entityId: task.id,
        metadata: {
          projectId: project.id,
          tokensUsed: input.tokensUsed,
          aiSystemId: input.aiSystemId ?? null,
          via: 'mcp',
          actingUserId,
        },
        ipAddress: ipAddress ?? null,
      });
      return { task };
    },

    async setProjectTaskRaci(input) {
      const actingUserId = requireActingUserId(client);
      const taskId = await resolveEntityId(app.database, {
        entityType: 'task',
        idOrKey: input.taskId,
      });
      const existing = await getTask(app.database, taskId);
      const project = await requirePmProject(app, client, existing.projectId, {
        forWrite: true,
      });
      const raci = await replaceTaskRaci(app.database, {
        taskId,
        workspaceId: project.workspaceId,
        entries: input.entries.map((entry) => ({
          userId: entry.userId,
          role: raciRoleSchema.parse(entry.role),
        })),
        actorUserId: actingUserId,
      });
      const task = await getTask(app.database, taskId);
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

    async listProjectEpics(input) {
      await requirePmProject(app, client, input.projectId);
      return {
        epics: await listEpics(app.database, input.projectId, {
          includeArchived: input.includeArchived,
        }),
      };
    },

    async createProjectEpic(input) {
      const actingUserId = requireActingUserId(client);
      const project = await requirePmProject(app, client, input.projectId, {
        forWrite: true,
      });
      const epic = await createEpic(app.database, {
        projectId: project.id,
        title: input.title,
        description: input.description,
        status: input.status ? epicStatusSchema.parse(input.status) : undefined,
        startDate: input.startDate,
        endDate: input.endDate,
        sortOrder: input.sortOrder,
      });
      await writeAuditEvent(app.database, {
        organizationId: client.organizationId,
        actorType: 'api_client',
        actorId: client.id,
        action: 'project.epic_created',
        entityType: 'project_epic',
        entityId: epic.id,
        metadata: { projectId: project.id, via: 'mcp', actingUserId },
        ipAddress: ipAddress ?? null,
      });
      return { epic };
    },

    async updateProjectEpic(input) {
      const actingUserId = requireActingUserId(client);
      const epicId = await resolveEntityId(app.database, {
        entityType: 'epic',
        idOrKey: input.epicId,
      });
      const existing = await getEpic(app.database, epicId);
      const project = await requirePmProject(app, client, existing.projectId, {
        forWrite: true,
      });
      const epic = await updateEpic(app.database, epicId, {
        title: input.title,
        description: input.description,
        status: input.status ? epicStatusSchema.parse(input.status) : undefined,
        startDate: input.startDate,
        endDate: input.endDate,
        sortOrder: input.sortOrder,
        archived: input.archived,
      });
      await writeAuditEvent(app.database, {
        organizationId: client.organizationId,
        actorType: 'api_client',
        actorId: client.id,
        action: 'project.epic_updated',
        entityType: 'project_epic',
        entityId: epic.id,
        metadata: { projectId: project.id, via: 'mcp', actingUserId },
        ipAddress: ipAddress ?? null,
      });
      return { epic };
    },

    async listProjectUserStories(input) {
      await requirePmProject(app, client, input.projectId);
      const epicId = input.epicId
        ? await resolveEntityId(app.database, {
            entityType: 'epic',
            idOrKey: input.epicId,
            projectId: input.projectId,
          })
        : undefined;
      return {
        userStories: await listUserStories(app.database, input.projectId, {
          epicId,
          includeArchived: input.includeArchived,
        }),
      };
    },

    async createProjectUserStory(input) {
      const actingUserId = requireActingUserId(client);
      const project = await requirePmProject(app, client, input.projectId, {
        forWrite: true,
      });
      const epicId = await resolveEntityId(app.database, {
        entityType: 'epic',
        idOrKey: input.epicId,
        projectId: project.id,
      });
      const userStory = await createUserStory(app.database, {
        projectId: project.id,
        epicId,
        title: input.title,
        description: input.description,
        status: input.status
          ? userStoryStatusSchema.parse(input.status)
          : undefined,
        startDate: input.startDate,
        endDate: input.endDate,
        sortOrder: input.sortOrder,
      });
      await writeAuditEvent(app.database, {
        organizationId: client.organizationId,
        actorType: 'api_client',
        actorId: client.id,
        action: 'project.user_story_created',
        entityType: 'project_user_story',
        entityId: userStory.id,
        metadata: { projectId: project.id, via: 'mcp', actingUserId },
        ipAddress: ipAddress ?? null,
      });
      return { userStory };
    },

    async updateProjectUserStory(input) {
      const actingUserId = requireActingUserId(client);
      const storyId = await resolveEntityId(app.database, {
        entityType: 'user_story',
        idOrKey: input.storyId,
      });
      const existing = await getUserStory(app.database, storyId);
      const project = await requirePmProject(app, client, existing.projectId, {
        forWrite: true,
      });
      const epicId =
        input.epicId === undefined
          ? undefined
          : await resolveEntityId(app.database, {
              entityType: 'epic',
              idOrKey: input.epicId,
              projectId: project.id,
            });
      const userStory = await updateUserStory(app.database, storyId, {
        title: input.title,
        description: input.description,
        status: input.status
          ? userStoryStatusSchema.parse(input.status)
          : undefined,
        epicId,
        startDate: input.startDate,
        endDate: input.endDate,
        sortOrder: input.sortOrder,
        archived: input.archived,
      });
      await writeAuditEvent(app.database, {
        organizationId: client.organizationId,
        actorType: 'api_client',
        actorId: client.id,
        action: 'project.user_story_updated',
        entityType: 'project_user_story',
        entityId: userStory.id,
        metadata: { projectId: project.id, via: 'mcp', actingUserId },
        ipAddress: ipAddress ?? null,
      });
      return { userStory };
    },

    async listProjectTaskActivities(input) {
      const taskId = await resolveEntityId(app.database, {
        entityType: 'task',
        idOrKey: input.taskId,
      });
      const task = await getTask(app.database, taskId);
      await requirePmProject(app, client, task.projectId);
      return {
        activities: await listTaskActivities(app.database, taskId),
      };
    },

    async addProjectTaskComment(input) {
      const actingUserId = requireActingUserId(client);
      const taskId = await resolveEntityId(app.database, {
        entityType: 'task',
        idOrKey: input.taskId,
      });
      const existing = await getTask(app.database, taskId);
      const project = await requirePmProject(app, client, existing.projectId, {
        forWrite: true,
      });
      const activity = await addTaskComment(app.database, {
        taskId,
        actorUserId: actingUserId,
        body: input.body,
      });
      await writeAuditEvent(app.database, {
        organizationId: client.organizationId,
        actorType: 'api_client',
        actorId: client.id,
        action: 'project.task_commented',
        entityType: 'project_task',
        entityId: existing.id,
        metadata: { projectId: project.id, via: 'mcp', actingUserId },
        ipAddress: ipAddress ?? null,
      });
      return { activity };
    },

    async handoffProjectTask(input) {
      const actingUserId = requireActingUserId(client);
      const taskId = await resolveEntityId(app.database, {
        entityType: 'task',
        idOrKey: input.taskId,
      });
      const existing = await getTask(app.database, taskId);
      const project = await requirePmProject(app, client, existing.projectId, {
        forWrite: true,
      });
      const task = await handoffTask(app.database, {
        taskId,
        workspaceId: project.workspaceId,
        actorUserId: actingUserId,
        toUserId: input.toUserId,
        note: input.note,
      });
      await writeAuditEvent(app.database, {
        organizationId: client.organizationId,
        actorType: 'api_client',
        actorId: client.id,
        action: 'project.task_handoff',
        entityType: 'project_task',
        entityId: task.id,
        metadata: {
          projectId: project.id,
          toUserId: input.toUserId,
          via: 'mcp',
          actingUserId,
        },
        ipAddress: ipAddress ?? null,
      });
      return { task };
    },

    async listProjectStakeholders(input) {
      await requirePmProject(app, client, input.projectId);
      return {
        stakeholders: await listProjectStakeholders(app.database, input.projectId),
      };
    },

    async createProjectStakeholder(input) {
      const actingUserId = requireActingUserId(client);
      const project = await requirePmProject(app, client, input.projectId, {
        forWrite: true,
      });
      const stakeholder = await upsertProjectStakeholder(app.database, {
        projectId: project.id,
        workspaceId: project.workspaceId,
        userId: input.userId,
        projectRole: projectStakeholderRoleSchema.parse(input.projectRole),
        jobTitle: input.jobTitle,
        notes: input.notes,
        reportsToUserId: input.reportsToUserId,
        hourlyRate:
          input.hourlyRate === undefined
            ? undefined
            : parseBudgetAmount(input.hourlyRate) ?? null,
        sortOrder: input.sortOrder,
        engagementType:
          input.engagementType === undefined
            ? undefined
            : input.engagementType == null
              ? null
              : stakeholderEngagementTypeSchema.parse(input.engagementType),
        assignmentStart: input.assignmentStart,
        assignmentEnd: input.assignmentEnd,
        allocatedDailyHours:
          input.allocatedDailyHours === undefined
            ? undefined
            : parseHours(input.allocatedDailyHours) ?? null,
        contractRef: input.contractRef,
        contractedBudget:
          input.contractedBudget === undefined
            ? undefined
            : parseBudgetAmount(input.contractedBudget) ?? null,
        contractStart: input.contractStart,
        contractEnd: input.contractEnd,
      });
      await writeAuditEvent(app.database, {
        organizationId: client.organizationId,
        actorType: 'api_client',
        actorId: client.id,
        action: 'project.stakeholder_upserted',
        entityType: 'project_stakeholder',
        entityId: stakeholder.rosterId ?? stakeholder.userId,
        metadata: {
          projectId: project.id,
          userId: stakeholder.userId,
          via: 'mcp',
          actingUserId,
        },
        ipAddress: ipAddress ?? null,
      });
      return { stakeholder };
    },

    async updateProjectStakeholder(input) {
      const actingUserId = requireActingUserId(client);
      const existing = await getRosterStakeholder(
        app.database,
        input.stakeholderId,
      );
      const project = await requirePmProject(app, client, existing.projectId, {
        forWrite: true,
      });
      const stakeholder = await updateProjectStakeholder(
        app.database,
        input.stakeholderId,
        {
          projectRole: input.projectRole
            ? projectStakeholderRoleSchema.parse(input.projectRole)
            : undefined,
          jobTitle: input.jobTitle,
          notes: input.notes,
          hourlyRate:
            input.hourlyRate === undefined
              ? undefined
              : parseBudgetAmount(input.hourlyRate) ?? null,
          reportsToUserId: input.reportsToUserId,
          sortOrder: input.sortOrder,
          engagementType:
            input.engagementType === undefined
              ? undefined
              : input.engagementType == null
                ? null
                : stakeholderEngagementTypeSchema.parse(input.engagementType),
          assignmentStart: input.assignmentStart,
          assignmentEnd: input.assignmentEnd,
          allocatedDailyHours:
            input.allocatedDailyHours === undefined
              ? undefined
              : parseHours(input.allocatedDailyHours) ?? null,
          contractRef: input.contractRef,
          contractedBudget:
            input.contractedBudget === undefined
              ? undefined
              : parseBudgetAmount(input.contractedBudget) ?? null,
          contractStart: input.contractStart,
          contractEnd: input.contractEnd,
        },
      );
      await writeAuditEvent(app.database, {
        organizationId: client.organizationId,
        actorType: 'api_client',
        actorId: client.id,
        action: 'project.stakeholder_updated',
        entityType: 'project_stakeholder',
        entityId: input.stakeholderId,
        metadata: {
          projectId: project.id,
          userId: stakeholder.userId,
          via: 'mcp',
          actingUserId,
        },
        ipAddress: ipAddress ?? null,
      });
      return { stakeholder };
    },

    async updateProjectAiAssistantCost(input) {
      const actingUserId = requireActingUserId(client);
      const [system] = await app.database.db
        .select({
          id: systems.id,
          projectId: systems.projectId,
        })
        .from(systems)
        .where(eq(systems.id, input.systemId))
        .limit(1);
      if (!system?.projectId) {
        throw new AppError({
          code: 'SYSTEM_NOT_FOUND',
          message: 'AI assistant system not found',
          statusCode: 404,
        });
      }
      const project = await requirePmProject(app, client, system.projectId, {
        forWrite: true,
      });
      const stakeholder = await updateAiAssistantCost(
        app.database,
        input.systemId,
        {
          aiCostMode:
            input.aiCostMode === undefined
              ? undefined
              : input.aiCostMode == null
                ? null
                : aiCostModeSchema.parse(input.aiCostMode),
          aiFlatMonthlyFee:
            input.aiFlatMonthlyFee === undefined
              ? undefined
              : parseBudgetAmount(input.aiFlatMonthlyFee) ?? null,
          aiTokenRatePer1k:
            input.aiTokenRatePer1k === undefined
              ? undefined
              : parseTokenRate(input.aiTokenRatePer1k) ?? null,
          aiBudgetAllocation:
            input.aiBudgetAllocation === undefined
              ? undefined
              : parseBudgetAmount(input.aiBudgetAllocation) ?? null,
        },
      );
      await upsertProjectCostSnapshot(app.database, project.id);
      await writeAuditEvent(app.database, {
        organizationId: client.organizationId,
        actorType: 'api_client',
        actorId: client.id,
        action: 'system.ai_cost_updated',
        entityType: 'system',
        entityId: input.systemId,
        metadata: { projectId: project.id, via: 'mcp', actingUserId },
        ipAddress: ipAddress ?? null,
      });
      return { stakeholder };
    },

    async deleteProjectStakeholder(input) {
      const actingUserId = requireActingUserId(client);
      const existing = await getRosterStakeholder(
        app.database,
        input.stakeholderId,
      );
      const project = await requirePmProject(app, client, existing.projectId, {
        forWrite: true,
      });
      const deleted = await deleteProjectStakeholder(
        app.database,
        input.stakeholderId,
      );
      await writeAuditEvent(app.database, {
        organizationId: client.organizationId,
        actorType: 'api_client',
        actorId: client.id,
        action: 'project.stakeholder_deleted',
        entityType: 'project_stakeholder',
        entityId: input.stakeholderId,
        metadata: {
          projectId: project.id,
          userId: deleted.userId,
          via: 'mcp',
          actingUserId,
        },
        ipAddress: ipAddress ?? null,
      });
      return { ok: true, ...deleted };
    },

    async listProjectRaidItems(input) {
      await requirePmProject(app, client, input.projectId);
      return {
        raidItems: await listRaidItems(app.database, input.projectId, {
          includeArchived: input.includeArchived,
        }),
      };
    },

    async createProjectRaidItem(input) {
      const actingUserId = requireActingUserId(client);
      const project = await requirePmProject(app, client, input.projectId, {
        forWrite: true,
      });
      const taskIds = input.taskIds
        ? await Promise.all(
            input.taskIds.map((idOrKey) =>
              resolveEntityId(app.database, {
                entityType: 'task',
                idOrKey,
                projectId: project.id,
              }),
            ),
          )
        : undefined;
      const raidItem = await createRaidItem(app.database, {
        projectId: project.id,
        workspaceId: project.workspaceId,
        kind: raidKindSchema.parse(input.kind),
        title: input.title,
        description: input.description,
        status: input.status
          ? raidStatusSchema.parse(input.status)
          : undefined,
        severity: input.severity
          ? raidSeveritySchema.parse(input.severity)
          : undefined,
        ownerUserId: input.ownerUserId,
        dueDate: input.dueDate,
        sortOrder: input.sortOrder,
        taskIds,
      });
      await writeAuditEvent(app.database, {
        organizationId: client.organizationId,
        actorType: 'api_client',
        actorId: client.id,
        action: 'project.raid_item_created',
        entityType: 'project_raid_item',
        entityId: raidItem.id,
        metadata: {
          projectId: project.id,
          kind: raidItem.kind,
          via: 'mcp',
          actingUserId,
        },
        ipAddress: ipAddress ?? null,
      });
      return { raidItem };
    },

    async updateProjectRaidItem(input) {
      const actingUserId = requireActingUserId(client);
      const raidItemId = await resolveEntityId(app.database, {
        entityType: 'raid',
        idOrKey: input.raidItemId,
      });
      const existing = await getRaidItem(app.database, raidItemId);
      const project = await requirePmProject(app, client, existing.projectId, {
        forWrite: true,
      });
      const raidItem = await updateRaidItem(app.database, raidItemId, {
        workspaceId: project.workspaceId,
        kind: input.kind ? raidKindSchema.parse(input.kind) : undefined,
        title: input.title,
        description: input.description,
        status: input.status
          ? raidStatusSchema.parse(input.status)
          : undefined,
        severity: input.severity
          ? raidSeveritySchema.parse(input.severity)
          : undefined,
        ownerUserId: input.ownerUserId,
        dueDate: input.dueDate,
        sortOrder: input.sortOrder,
        archived: input.archived,
      });
      await writeAuditEvent(app.database, {
        organizationId: client.organizationId,
        actorType: 'api_client',
        actorId: client.id,
        action: 'project.raid_item_updated',
        entityType: 'project_raid_item',
        entityId: raidItem.id,
        metadata: { projectId: project.id, via: 'mcp', actingUserId },
        ipAddress: ipAddress ?? null,
      });
      return { raidItem };
    },

    async transferProjectRaidItem(input: {
      raidItemId: string;
      targetKind: 'issue' | 'risk';
    }) {
      const actingUserId = requireActingUserId(client);
      const raidItemId = await resolveEntityId(app.database, {
        entityType: 'raid',
        idOrKey: input.raidItemId,
      });
      const existing = await getRaidItem(app.database, raidItemId);
      const project = await requirePmProject(app, client, existing.projectId, {
        forWrite: true,
      });
      const result = await transferRaidItem(
        app.database,
        raidItemId,
        input.targetKind,
      );
      await writeAuditEvent(app.database, {
        organizationId: client.organizationId,
        actorType: 'api_client',
        actorId: client.id,
        action:
          input.targetKind === 'issue'
            ? 'raid.transferred_to_issue'
            : 'raid.transferred_to_risk',
        entityType: 'project_raid_item',
        entityId: result.source.id,
        metadata: {
          projectId: project.id,
          sourceHumanKey: result.source.humanKey,
          targetHumanKey: result.target.humanKey,
          targetKind: input.targetKind,
          via: 'mcp',
          actingUserId,
        },
        ipAddress: ipAddress ?? null,
      });
      return result;
    },

    async setProjectRaidTaskLinks(input) {
      const actingUserId = requireActingUserId(client);
      const raidItemId = await resolveEntityId(app.database, {
        entityType: 'raid',
        idOrKey: input.raidItemId,
      });
      const existing = await getRaidItem(app.database, raidItemId);
      const project = await requirePmProject(app, client, existing.projectId, {
        forWrite: true,
      });
      const taskIds = await Promise.all(
        input.taskIds.map((idOrKey) =>
          resolveEntityId(app.database, {
            entityType: 'task',
            idOrKey,
            projectId: project.id,
          }),
        ),
      );
      const raidItem = await setRaidTaskLinks(app.database, {
        raidItemId,
        projectId: project.id,
        taskIds,
      });
      await writeAuditEvent(app.database, {
        organizationId: client.organizationId,
        actorType: 'api_client',
        actorId: client.id,
        action: 'project.raid_task_links_set',
        entityType: 'project_raid_item',
        entityId: raidItem.id,
        metadata: {
          projectId: project.id,
          taskIds: input.taskIds,
          via: 'mcp',
          actingUserId,
        },
        ipAddress: ipAddress ?? null,
      });
      return { raidItem };
    },

    async getKnowledgeRecordDeliveryLinks(input) {
      const record = await getKnowledgeRecordProjectContext(
        app.database,
        input.recordId,
      );
      assertWorkspaceAllowed(client, record.workspaceId);
      return {
        deliveryLinks: await listDeliveryLinksForRecord(
          app.database,
          input.recordId,
        ),
      };
    },

    async listProjectChangeItems(input: {
      projectId: string;
      includeArchived?: boolean;
    }) {
      await requirePmProject(app, client, input.projectId);
      return {
        changeItems: await listChangeItems(app.database, input.projectId, {
          includeArchived: input.includeArchived,
        }),
      };
    },

    async createProjectChangeItem(input: {
      projectId: string;
      kind: string;
      title: string;
      description?: string | null;
      rationale?: string | null;
      status?: string;
      requestedByUserId?: string | null;
      approvedByUserId?: string | null;
      effectiveDate?: string | null;
      baselineStartBefore?: string | null;
      baselineStartAfter?: string | null;
      baselineEndBefore?: string | null;
      baselineEndAfter?: string | null;
      knowledgeRecordId?: string | null;
      sortOrder?: number;
      deliveryLinks?: Array<{ entityType: string; entityId: string }>;
    }) {
      const actingUserId = requireActingUserId(client);
      const project = await requirePmProject(app, client, input.projectId, {
        forWrite: true,
      });
      const changeItem = await createChangeItem(app.database, {
        projectId: project.id,
        workspaceId: project.workspaceId,
        kind: changeKindSchema.parse(input.kind),
        title: input.title,
        description: input.description,
        rationale: input.rationale,
        status: input.status
          ? changeStatusSchema.parse(input.status)
          : undefined,
        requestedByUserId: input.requestedByUserId ?? actingUserId,
        approvedByUserId: input.approvedByUserId,
        effectiveDate: input.effectiveDate,
        baselineStartBefore: input.baselineStartBefore,
        baselineStartAfter: input.baselineStartAfter,
        baselineEndBefore: input.baselineEndBefore,
        baselineEndAfter: input.baselineEndAfter,
        knowledgeRecordId: input.knowledgeRecordId,
        sortOrder: input.sortOrder,
        deliveryLinks: input.deliveryLinks?.map((link) => ({
          entityType: changeDeliveryEntityTypeSchema.parse(link.entityType),
          entityId: link.entityId,
        })),
      });
      await writeAuditEvent(app.database, {
        organizationId: client.organizationId,
        actorType: 'api_client',
        actorId: client.id,
        action: 'project.change_item_created',
        entityType: 'project_change_item',
        entityId: changeItem.id,
        metadata: {
          projectId: project.id,
          kind: changeItem.kind,
          via: 'mcp',
          actingUserId,
        },
        ipAddress: ipAddress ?? null,
      });
      return { changeItem };
    },

    async updateProjectChangeItem(input: {
      changeId: string;
      kind?: string;
      title?: string;
      description?: string | null;
      rationale?: string | null;
      status?: string;
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
      deliveryLinks?: Array<{ entityType: string; entityId: string }>;
    }) {
      const actingUserId = requireActingUserId(client);
      const changeId = await resolveEntityId(app.database, {
        entityType: 'change',
        idOrKey: input.changeId,
      });
      const existing = await getChangeItem(app.database, changeId);
      const project = await requirePmProject(app, client, existing.projectId, {
        forWrite: true,
      });
      const changeItem = await updateChangeItem(app.database, changeId, {
        workspaceId: project.workspaceId,
        kind: input.kind ? changeKindSchema.parse(input.kind) : undefined,
        title: input.title,
        description: input.description,
        rationale: input.rationale,
        status: input.status
          ? changeStatusSchema.parse(input.status)
          : undefined,
        requestedByUserId: input.requestedByUserId,
        approvedByUserId: input.approvedByUserId,
        effectiveDate: input.effectiveDate,
        baselineStartBefore: input.baselineStartBefore,
        baselineStartAfter: input.baselineStartAfter,
        baselineEndBefore: input.baselineEndBefore,
        baselineEndAfter: input.baselineEndAfter,
        knowledgeRecordId: input.knowledgeRecordId,
        sortOrder: input.sortOrder,
        archived: input.archived,
        deliveryLinks: input.deliveryLinks?.map((link) => ({
          entityType: changeDeliveryEntityTypeSchema.parse(link.entityType),
          entityId: link.entityId,
        })),
      });
      await writeAuditEvent(app.database, {
        organizationId: client.organizationId,
        actorType: 'api_client',
        actorId: client.id,
        action: 'project.change_item_updated',
        entityType: 'project_change_item',
        entityId: changeItem.id,
        metadata: { projectId: project.id, via: 'mcp', actingUserId },
        ipAddress: ipAddress ?? null,
      });
      return { changeItem };
    },

    async setKnowledgeRecordDeliveryLinks(input) {
      const actingUserId = requireActingUserId(client);
      const record = await getKnowledgeRecordProjectContext(
        app.database,
        input.recordId,
      );
      assertWriteWorkspaceAllowed(client, record.workspaceId);
      if (record.projectId) {
        const { project } = await requireProjectContext(
          app.database,
          record.projectId,
        );
        assertProjectNotArchived(project);
      }
      const deliveryLinks = await setDeliveryLinksForRecord(app.database, {
        knowledgeRecordId: input.recordId,
        links: input.links.map((link) => ({
          entityType: deliveryLinkEntityTypeSchema.parse(link.entityType),
          entityId: link.entityId,
        })),
      });
      await writeAuditEvent(app.database, {
        organizationId: client.organizationId,
        actorType: 'api_client',
        actorId: client.id,
        action: 'knowledge.delivery_links_set',
        entityType: 'knowledge_record',
        entityId: input.recordId,
        metadata: {
          projectId: record.projectId,
          linkCount: deliveryLinks.length,
          via: 'mcp',
          actingUserId,
        },
        ipAddress: ipAddress ?? null,
      });
      return { deliveryLinks };
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
