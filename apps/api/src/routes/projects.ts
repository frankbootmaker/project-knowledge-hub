import type { FastifyInstance } from 'fastify';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { slugify } from '@project-knowledge-hub/auth';
import { projects, workspaces } from '@project-knowledge-hub/database';
import {
  AppError,
  projectCurrencySchema,
  projectStakeholderRoleSchema,
  projectStatusSchema,
} from '@project-knowledge-hub/domain';
import {
  parseBudgetAmount,
  upsertProjectCostSnapshot,
} from '../lib/project-budget.js';
import {
  requireWorkspaceAdmin,
  requireWorkspaceMaintainer,
  requireWorkspaceView,
} from '@project-knowledge-hub/permissions';
import {
  assertMutatingOrigin,
  requireAuthenticated,
} from '../plugins/auth.js';
import { writeAuditEvent } from '../lib/identity.js';
import { getProjectTags, setProjectTags } from '../lib/tags.js';
import {
  assertPinnedKnowledgeRecord,
  listInitialStakeholders,
  loadPinnedRecords,
  setInitialStakeholders,
} from '../lib/project-baseline.js';

const dateStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable();

const createProjectSchema = z.object({
  workspaceId: z.string().uuid(),
  name: z.string().min(1).max(160),
  slug: z.string().min(1).max(64).optional(),
  summary: z.string().max(500).optional(),
  description: z.string().max(10000).optional(),
  status: projectStatusSchema.optional(),
  ownerUserId: z.string().uuid().nullable().optional(),
  businessDomain: z.string().max(160).optional(),
  criticality: z.string().max(80).optional(),
  startDate: dateStringSchema.optional(),
  endDate: dateStringSchema.optional(),
  charterRecordId: z.string().uuid().nullable().optional(),
  initialPlanRecordId: z.string().uuid().nullable().optional(),
  currency: projectCurrencySchema.optional(),
  initialBudget: z.union([z.number(), z.string()]).nullable().optional(),
  approvedBudget: z.union([z.number(), z.string()]).nullable().optional(),
  tags: z.array(z.string().min(1).max(64)).max(30).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const updateProjectSchema = z.object({
  name: z.string().min(1).max(160).optional(),
  summary: z.string().max(500).nullable().optional(),
  description: z.string().max(10000).nullable().optional(),
  status: projectStatusSchema.optional(),
  ownerUserId: z.string().uuid().nullable().optional(),
  businessDomain: z.string().max(160).nullable().optional(),
  criticality: z.string().max(80).nullable().optional(),
  startDate: dateStringSchema.optional(),
  endDate: dateStringSchema.optional(),
  charterRecordId: z.string().uuid().nullable().optional(),
  initialPlanRecordId: z.string().uuid().nullable().optional(),
  currency: projectCurrencySchema.optional(),
  initialBudget: z.union([z.number(), z.string()]).nullable().optional(),
  approvedBudget: z.union([z.number(), z.string()]).nullable().optional(),
  tags: z.array(z.string().min(1).max(64)).max(30).optional(),
  metadata: z.record(z.unknown()).nullable().optional(),
  archived: z.boolean().optional(),
});

const initialStakeholdersSchema = z.object({
  stakeholders: z
    .array(
      z.object({
        userId: z.string().uuid(),
        projectRole: projectStakeholderRoleSchema.optional(),
        sortOrder: z.number().int().min(0).max(100000).optional(),
      }),
    )
    .max(200),
});

async function toPublicProject(
  database: Parameters<typeof loadPinnedRecords>[0],
  project: typeof projects.$inferSelect,
  tagList: Array<{ id: string; name: string; slug: string }>,
) {
  const pinned = await loadPinnedRecords(database, [
    project.charterRecordId,
    project.initialPlanRecordId,
  ]);
  return {
    id: project.id,
    workspaceId: project.workspaceId,
    name: project.name,
    slug: project.slug,
    summary: project.summary,
    description: project.description,
    status: project.status,
    ownerUserId: project.ownerUserId,
    businessDomain: project.businessDomain,
    criticality: project.criticality,
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
    metadata: project.metadataJson,
    tags: tagList,
    archivedAt: project.archivedAt?.toISOString() ?? null,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
}

export async function registerProjectRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/projects', async (request) => {
    const principal = requireAuthenticated(request);
    const query = z
      .object({
        workspaceId: z.string().uuid(),
        includeArchived: z
          .enum(['true', 'false'])
          .optional()
          .transform((value) => value === 'true'),
      })
      .parse(request.query);

    requireWorkspaceView(principal, query.workspaceId);

    const rows = await app.database.db
      .select()
      .from(projects)
      .where(
        query.includeArchived
          ? eq(projects.workspaceId, query.workspaceId)
          : and(eq(projects.workspaceId, query.workspaceId), isNull(projects.archivedAt)),
      );

    const tagMap = await getProjectTags(
      app.database,
      rows.map((row) => row.id),
    );

    return {
      projects: await Promise.all(
        rows.map((row) =>
          toPublicProject(app.database, row, tagMap.get(row.id) ?? []),
        ),
      ),
    };
  });

  app.post('/api/v1/projects', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    const body = createProjectSchema.parse(request.body);
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

    const slug = body.slug ? slugify(body.slug) : slugify(body.name);
    if (!slug) {
      throw new AppError({
        code: 'VALIDATION_ERROR',
        message: 'Project slug is invalid',
        statusCode: 400,
      });
    }

    const [existing] = await app.database.db
      .select()
      .from(projects)
      .where(and(eq(projects.workspaceId, body.workspaceId), eq(projects.slug, slug)))
      .limit(1);

    if (existing) {
      throw new AppError({
        code: 'PROJECT_SLUG_CONFLICT',
        message: 'A project with this slug already exists in the workspace',
        statusCode: 409,
      });
    }

    const [created] = await app.database.db
      .insert(projects)
      .values({
        workspaceId: body.workspaceId,
        name: body.name,
        slug,
        summary: body.summary ?? null,
        description: body.description ?? null,
        status: body.status ?? 'idea',
        ownerUserId: body.ownerUserId ?? principal.userId,
        businessDomain: body.businessDomain ?? null,
        criticality: body.criticality ?? null,
        startDate: body.startDate ?? null,
        endDate: body.endDate ?? null,
        charterRecordId: null,
        initialPlanRecordId: null,
        currency: body.currency ?? 'EUR',
        initialBudget:
          body.initialBudget === undefined
            ? null
            : parseBudgetAmount(body.initialBudget) ?? null,
        approvedBudget:
          body.approvedBudget === undefined
            ? null
            : parseBudgetAmount(body.approvedBudget) ?? null,
        metadataJson: body.metadata ?? null,
        updatedAt: new Date(),
      })
      .returning();

    if (!created) {
      throw new AppError({
        code: 'PROJECT_CREATE_FAILED',
        message: 'Failed to create project',
        statusCode: 500,
      });
    }

    if (body.charterRecordId) {
      await assertPinnedKnowledgeRecord(app.database, {
        recordId: body.charterRecordId,
        projectId: created.id,
        expectedTypes: ['project-charter'],
      });
    }
    if (body.initialPlanRecordId) {
      await assertPinnedKnowledgeRecord(app.database, {
        recordId: body.initialPlanRecordId,
        projectId: created.id,
        expectedTypes: ['plan'],
      });
    }
    if (body.charterRecordId || body.initialPlanRecordId) {
      await app.database.db
        .update(projects)
        .set({
          charterRecordId: body.charterRecordId ?? null,
          initialPlanRecordId: body.initialPlanRecordId ?? null,
          updatedAt: new Date(),
        })
        .where(eq(projects.id, created.id));
    }

    const [fresh] = await app.database.db
      .select()
      .from(projects)
      .where(eq(projects.id, created.id))
      .limit(1);

    const tagList = await setProjectTags(
      app.database,
      created.id,
      workspace.organizationId,
      body.tags ?? [],
    );

    await writeAuditEvent(app.database, {
      organizationId: workspace.organizationId,
      actorType: 'user',
      actorId: principal.userId,
      action: 'project.create',
      entityType: 'project',
      entityId: created.id,
      metadata: { slug: created.slug, name: created.name },
      ipAddress: request.ip,
    });

    return {
      project: await toPublicProject(app.database, fresh ?? created, tagList),
    };
  });

  app.get('/api/v1/projects/:projectId', async (request) => {
    const principal = requireAuthenticated(request);
    const params = z.object({ projectId: z.string().uuid() }).parse(request.params);
    const [project] = await app.database.db
      .select()
      .from(projects)
      .where(eq(projects.id, params.projectId))
      .limit(1);

    if (!project) {
      throw new AppError({
        code: 'PROJECT_NOT_FOUND',
        message: 'Project not found',
        statusCode: 404,
      });
    }

    requireWorkspaceView(principal, project.workspaceId);
    const tagMap = await getProjectTags(app.database, [project.id]);
    return {
      project: await toPublicProject(
        app.database,
        project,
        tagMap.get(project.id) ?? [],
      ),
    };
  });

  app.get('/api/v1/projects/:projectId/initial-stakeholders', async (request) => {
    const principal = requireAuthenticated(request);
    const params = z.object({ projectId: z.string().uuid() }).parse(request.params);
    const [project] = await app.database.db
      .select()
      .from(projects)
      .where(eq(projects.id, params.projectId))
      .limit(1);
    if (!project) {
      throw new AppError({
        code: 'PROJECT_NOT_FOUND',
        message: 'Project not found',
        statusCode: 404,
      });
    }
    requireWorkspaceView(principal, project.workspaceId);
    return {
      initialStakeholders: await listInitialStakeholders(
        app.database,
        project.id,
      ),
    };
  });

  app.put('/api/v1/projects/:projectId/initial-stakeholders', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    const params = z.object({ projectId: z.string().uuid() }).parse(request.params);
    const body = initialStakeholdersSchema.parse(request.body);
    const [project] = await app.database.db
      .select()
      .from(projects)
      .where(eq(projects.id, params.projectId))
      .limit(1);
    if (!project) {
      throw new AppError({
        code: 'PROJECT_NOT_FOUND',
        message: 'Project not found',
        statusCode: 404,
      });
    }
    requireWorkspaceMaintainer(principal, project.workspaceId);
    if (project.archivedAt) {
      throw new AppError({
        code: 'PROJECT_ARCHIVED',
        message: 'Archived projects are read-only',
        statusCode: 409,
      });
    }

    const initialStakeholders = await setInitialStakeholders(app.database, {
      projectId: project.id,
      workspaceId: project.workspaceId,
      stakeholders: body.stakeholders,
    });

    const [workspace] = await app.database.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, project.workspaceId))
      .limit(1);

    await writeAuditEvent(app.database, {
      organizationId: workspace?.organizationId ?? null,
      actorType: 'user',
      actorId: principal.userId,
      action: 'project.initial_stakeholders_set',
      entityType: 'project',
      entityId: project.id,
      metadata: { count: initialStakeholders.length },
      ipAddress: request.ip,
    });

    return { initialStakeholders };
  });

  app.patch('/api/v1/projects/:projectId', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    const params = z.object({ projectId: z.string().uuid() }).parse(request.params);
    const body = updateProjectSchema.parse(request.body);

    const [project] = await app.database.db
      .select()
      .from(projects)
      .where(eq(projects.id, params.projectId))
      .limit(1);

    if (!project) {
      throw new AppError({
        code: 'PROJECT_NOT_FOUND',
        message: 'Project not found',
        statusCode: 404,
      });
    }

    requireWorkspaceMaintainer(principal, project.workspaceId);

    const [workspace] = await app.database.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, project.workspaceId))
      .limit(1);

    const nextCharterId =
      body.charterRecordId === undefined
        ? project.charterRecordId
        : body.charterRecordId;
    const nextPlanId =
      body.initialPlanRecordId === undefined
        ? project.initialPlanRecordId
        : body.initialPlanRecordId;

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

    const [updated] = await app.database.db
      .update(projects)
      .set({
        name: body.name ?? project.name,
        summary: body.summary === undefined ? project.summary : body.summary,
        description: body.description === undefined ? project.description : body.description,
        status: body.status ?? project.status,
        ownerUserId: body.ownerUserId === undefined ? project.ownerUserId : body.ownerUserId,
        businessDomain:
          body.businessDomain === undefined ? project.businessDomain : body.businessDomain,
        criticality: body.criticality === undefined ? project.criticality : body.criticality,
        startDate: body.startDate === undefined ? project.startDate : body.startDate,
        endDate: body.endDate === undefined ? project.endDate : body.endDate,
        charterRecordId: nextCharterId,
        initialPlanRecordId: nextPlanId,
        currency: body.currency ?? project.currency,
        initialBudget:
          body.initialBudget === undefined
            ? project.initialBudget
            : parseBudgetAmount(body.initialBudget) ?? null,
        approvedBudget:
          body.approvedBudget === undefined
            ? project.approvedBudget
            : parseBudgetAmount(body.approvedBudget) ?? null,
        metadataJson: body.metadata === undefined ? project.metadataJson : body.metadata,
        archivedAt:
          body.archived === undefined
            ? project.archivedAt
            : body.archived
              ? new Date()
              : null,
        updatedAt: new Date(),
      })
      .where(eq(projects.id, params.projectId))
      .returning();

    if (!updated) {
      throw new AppError({
        code: 'PROJECT_UPDATE_FAILED',
        message: 'Failed to update project',
        statusCode: 500,
      });
    }

    let tagList =
      (await getProjectTags(app.database, [updated.id])).get(updated.id) ?? [];
    if (body.tags && workspace) {
      tagList = await setProjectTags(
        app.database,
        updated.id,
        workspace.organizationId,
        body.tags,
      );
    }

    if (
      body.currency !== undefined ||
      body.initialBudget !== undefined ||
      body.approvedBudget !== undefined
    ) {
      await upsertProjectCostSnapshot(app.database, updated.id);
    }

    await writeAuditEvent(app.database, {
      organizationId: workspace?.organizationId ?? null,
      actorType: 'user',
      actorId: principal.userId,
      action: 'project.update',
      entityType: 'project',
      entityId: updated.id,
      metadata: body,
      ipAddress: request.ip,
    });

    return {
      project: await toPublicProject(app.database, updated, tagList),
    };
  });

  app.delete('/api/v1/projects/:projectId', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    const params = z.object({ projectId: z.string().uuid() }).parse(request.params);

    const [project] = await app.database.db
      .select()
      .from(projects)
      .where(eq(projects.id, params.projectId))
      .limit(1);

    if (!project || project.archivedAt) {
      throw new AppError({
        code: 'PROJECT_NOT_FOUND',
        message: 'Project not found',
        statusCode: 404,
      });
    }

    requireWorkspaceMaintainer(principal, project.workspaceId);

    const [archived] = await app.database.db
      .update(projects)
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(eq(projects.id, params.projectId))
      .returning();

    const [workspace] = await app.database.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, project.workspaceId))
      .limit(1);

    await writeAuditEvent(app.database, {
      organizationId: workspace?.organizationId ?? null,
      actorType: 'user',
      actorId: principal.userId,
      action: 'project.archive',
      entityType: 'project',
      entityId: project.id,
      ipAddress: request.ip,
    });

    const tagMap = await getProjectTags(app.database, [project.id]);
    return {
      project: archived
        ? await toPublicProject(
            app.database,
            archived,
            tagMap.get(archived.id) ?? [],
          )
        : null,
    };
  });

  /** Permanent delete — linked systems/records/git keep their rows but lose projectId. */
  app.post('/api/v1/projects/:projectId/purge', async (request, reply) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    const params = z.object({ projectId: z.string().uuid() }).parse(request.params);
    z.object({ confirmDestroy: z.literal(true) }).parse(request.body ?? {});

    const [project] = await app.database.db
      .select()
      .from(projects)
      .where(eq(projects.id, params.projectId))
      .limit(1);

    if (!project) {
      throw new AppError({
        code: 'PROJECT_NOT_FOUND',
        message: 'Project not found',
        statusCode: 404,
      });
    }

    requireWorkspaceAdmin(principal, project.workspaceId);

    const [workspace] = await app.database.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, project.workspaceId))
      .limit(1);

    await app.database.db.delete(projects).where(eq(projects.id, project.id));

    await writeAuditEvent(app.database, {
      organizationId: workspace?.organizationId ?? null,
      actorType: 'user',
      actorId: principal.userId,
      action: 'project.purge',
      entityType: 'project',
      entityId: project.id,
      metadata: { name: project.name, slug: project.slug },
      ipAddress: request.ip,
    });

    return reply.status(204).send();
  });
}
