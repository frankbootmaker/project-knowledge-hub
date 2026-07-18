import type { FastifyInstance } from 'fastify';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { slugify } from '@project-knowledge-hub/auth';
import { projects, workspaces } from '@project-knowledge-hub/database';
import { AppError, projectStatusSchema } from '@project-knowledge-hub/domain';
import {
  requireWorkspaceMaintainer,
  requireWorkspaceView,
} from '@project-knowledge-hub/permissions';
import {
  assertMutatingOrigin,
  requireAuthenticated,
} from '../plugins/auth.js';
import { writeAuditEvent } from '../lib/identity.js';
import { getProjectTags, setProjectTags } from '../lib/tags.js';

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
  tags: z.array(z.string().min(1).max(64)).max(30).optional(),
  metadata: z.record(z.unknown()).nullable().optional(),
  archived: z.boolean().optional(),
});

function toPublicProject(
  project: typeof projects.$inferSelect,
  tagList: Array<{ id: string; name: string; slug: string }>,
) {
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
      projects: rows.map((row) => toPublicProject(row, tagMap.get(row.id) ?? [])),
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

    return { project: toPublicProject(created, tagList) };
  });

  app.get('/api/v1/projects/:projectId', async (request) => {
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

    requireWorkspaceView(principal, project.workspaceId);
    const tagMap = await getProjectTags(app.database, [project.id]);
    return { project: toPublicProject(project, tagMap.get(project.id) ?? []) };
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

    return { project: toPublicProject(updated, tagList) };
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
        ? toPublicProject(archived, tagMap.get(archived.id) ?? [])
        : null,
    };
  });
}
