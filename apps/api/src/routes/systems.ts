import type { FastifyInstance } from 'fastify';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { slugify } from '@project-knowledge-hub/auth';
import { projects, systems, workspaces } from '@project-knowledge-hub/database';
import { AppError, systemStatusSchema } from '@project-knowledge-hub/domain';
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
import { getSystemTags, setSystemTags } from '../lib/tags.js';

const createSystemSchema = z.object({
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid().nullable().optional(),
  name: z.string().min(1).max(160),
  slug: z.string().min(1).max(64).optional(),
  summary: z.string().max(500).optional(),
  description: z.string().max(10000).optional(),
  systemType: z.string().max(120).optional(),
  status: systemStatusSchema.optional(),
  ownerUserId: z.string().uuid().nullable().optional(),
  environment: z.string().max(80).optional(),
  version: z.string().max(80).optional(),
  criticality: z.string().max(80).optional(),
  tags: z.array(z.string().min(1).max(64)).max(30).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const updateSystemSchema = z.object({
  projectId: z.string().uuid().nullable().optional(),
  name: z.string().min(1).max(160).optional(),
  summary: z.string().max(500).nullable().optional(),
  description: z.string().max(10000).nullable().optional(),
  systemType: z.string().max(120).nullable().optional(),
  status: systemStatusSchema.optional(),
  ownerUserId: z.string().uuid().nullable().optional(),
  environment: z.string().max(80).nullable().optional(),
  version: z.string().max(80).nullable().optional(),
  criticality: z.string().max(80).nullable().optional(),
  tags: z.array(z.string().min(1).max(64)).max(30).optional(),
  metadata: z.record(z.unknown()).nullable().optional(),
  archived: z.boolean().optional(),
});

function toPublicSystem(
  system: typeof systems.$inferSelect,
  tagList: Array<{ id: string; name: string; slug: string }>,
) {
  return {
    id: system.id,
    workspaceId: system.workspaceId,
    projectId: system.projectId,
    name: system.name,
    slug: system.slug,
    summary: system.summary,
    description: system.description,
    systemType: system.systemType,
    status: system.status,
    ownerUserId: system.ownerUserId,
    environment: system.environment,
    version: system.version,
    criticality: system.criticality,
    metadata: system.metadataJson,
    tags: tagList,
    lastValidatedAt: system.lastValidatedAt?.toISOString() ?? null,
    archivedAt: system.archivedAt?.toISOString() ?? null,
    createdAt: system.createdAt.toISOString(),
    updatedAt: system.updatedAt.toISOString(),
  };
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
      message: 'Associated project was not found in this workspace',
      statusCode: 400,
    });
  }
}

export async function registerSystemRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/systems', async (request) => {
    const principal = requireAuthenticated(request);
    const query = z
      .object({
        workspaceId: z.string().uuid(),
        projectId: z.string().uuid().optional(),
        includeArchived: z
          .enum(['true', 'false'])
          .optional()
          .transform((value) => value === 'true'),
      })
      .parse(request.query);

    requireWorkspaceView(principal, query.workspaceId);

    const filters = [eq(systems.workspaceId, query.workspaceId)];
    if (!query.includeArchived) {
      filters.push(isNull(systems.archivedAt));
    }
    if (query.projectId) {
      filters.push(eq(systems.projectId, query.projectId));
    }

    const rows = await app.database.db
      .select()
      .from(systems)
      .where(and(...filters));

    const tagMap = await getSystemTags(
      app.database,
      rows.map((row) => row.id),
    );

    return {
      systems: rows.map((row) => toPublicSystem(row, tagMap.get(row.id) ?? [])),
    };
  });

  app.post('/api/v1/systems', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    const body = createSystemSchema.parse(request.body);
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

    const slug = body.slug ? slugify(body.slug) : slugify(body.name);
    if (!slug) {
      throw new AppError({
        code: 'VALIDATION_ERROR',
        message: 'System slug is invalid',
        statusCode: 400,
      });
    }

    const [existing] = await app.database.db
      .select()
      .from(systems)
      .where(and(eq(systems.workspaceId, body.workspaceId), eq(systems.slug, slug)))
      .limit(1);

    if (existing) {
      throw new AppError({
        code: 'SYSTEM_SLUG_CONFLICT',
        message: 'A system with this slug already exists in the workspace',
        statusCode: 409,
      });
    }

    const [created] = await app.database.db
      .insert(systems)
      .values({
        workspaceId: body.workspaceId,
        projectId: body.projectId ?? null,
        name: body.name,
        slug,
        summary: body.summary ?? null,
        description: body.description ?? null,
        systemType: body.systemType ?? null,
        status: body.status ?? 'proposed',
        ownerUserId: body.ownerUserId ?? principal.userId,
        environment: body.environment ?? null,
        version: body.version ?? null,
        criticality: body.criticality ?? null,
        metadataJson: body.metadata ?? null,
        updatedAt: new Date(),
      })
      .returning();

    if (!created) {
      throw new AppError({
        code: 'SYSTEM_CREATE_FAILED',
        message: 'Failed to create system',
        statusCode: 500,
      });
    }

    const tagList = await setSystemTags(
      app.database,
      created.id,
      workspace.organizationId,
      body.tags ?? [],
    );

    await writeAuditEvent(app.database, {
      organizationId: workspace.organizationId,
      actorType: 'user',
      actorId: principal.userId,
      action: 'system.create',
      entityType: 'system',
      entityId: created.id,
      metadata: { slug: created.slug, name: created.name, projectId: created.projectId },
      ipAddress: request.ip,
    });

    return { system: toPublicSystem(created, tagList) };
  });

  app.get('/api/v1/systems/:systemId', async (request) => {
    const principal = requireAuthenticated(request);
    const params = z.object({ systemId: z.string().uuid() }).parse(request.params);
    const [system] = await app.database.db
      .select()
      .from(systems)
      .where(eq(systems.id, params.systemId))
      .limit(1);

    if (!system) {
      throw new AppError({
        code: 'SYSTEM_NOT_FOUND',
        message: 'System not found',
        statusCode: 404,
      });
    }

    requireWorkspaceView(principal, system.workspaceId);
    const tagMap = await getSystemTags(app.database, [system.id]);
    return { system: toPublicSystem(system, tagMap.get(system.id) ?? []) };
  });

  app.patch('/api/v1/systems/:systemId', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    const params = z.object({ systemId: z.string().uuid() }).parse(request.params);
    const body = updateSystemSchema.parse(request.body);

    const [system] = await app.database.db
      .select()
      .from(systems)
      .where(eq(systems.id, params.systemId))
      .limit(1);

    if (!system) {
      throw new AppError({
        code: 'SYSTEM_NOT_FOUND',
        message: 'System not found',
        statusCode: 404,
      });
    }

    requireWorkspaceMaintainer(principal, system.workspaceId);
    await assertProjectInWorkspace(
      app,
      system.workspaceId,
      body.projectId === undefined ? system.projectId : body.projectId,
    );

    const [workspace] = await app.database.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, system.workspaceId))
      .limit(1);

    const [updated] = await app.database.db
      .update(systems)
      .set({
        projectId: body.projectId === undefined ? system.projectId : body.projectId,
        name: body.name ?? system.name,
        summary: body.summary === undefined ? system.summary : body.summary,
        description: body.description === undefined ? system.description : body.description,
        systemType: body.systemType === undefined ? system.systemType : body.systemType,
        status: body.status ?? system.status,
        ownerUserId: body.ownerUserId === undefined ? system.ownerUserId : body.ownerUserId,
        environment: body.environment === undefined ? system.environment : body.environment,
        version: body.version === undefined ? system.version : body.version,
        criticality: body.criticality === undefined ? system.criticality : body.criticality,
        metadataJson: body.metadata === undefined ? system.metadataJson : body.metadata,
        archivedAt:
          body.archived === undefined
            ? system.archivedAt
            : body.archived
              ? new Date()
              : null,
        updatedAt: new Date(),
      })
      .where(eq(systems.id, params.systemId))
      .returning();

    if (!updated) {
      throw new AppError({
        code: 'SYSTEM_UPDATE_FAILED',
        message: 'Failed to update system',
        statusCode: 500,
      });
    }

    let tagList = (await getSystemTags(app.database, [updated.id])).get(updated.id) ?? [];
    if (body.tags && workspace) {
      tagList = await setSystemTags(
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
      action: 'system.update',
      entityType: 'system',
      entityId: updated.id,
      metadata: body,
      ipAddress: request.ip,
    });

    return { system: toPublicSystem(updated, tagList) };
  });

  app.delete('/api/v1/systems/:systemId', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    const params = z.object({ systemId: z.string().uuid() }).parse(request.params);

    const [system] = await app.database.db
      .select()
      .from(systems)
      .where(eq(systems.id, params.systemId))
      .limit(1);

    if (!system || system.archivedAt) {
      throw new AppError({
        code: 'SYSTEM_NOT_FOUND',
        message: 'System not found',
        statusCode: 404,
      });
    }

    requireWorkspaceMaintainer(principal, system.workspaceId);

    const [archived] = await app.database.db
      .update(systems)
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(eq(systems.id, params.systemId))
      .returning();

    const [workspace] = await app.database.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, system.workspaceId))
      .limit(1);

    await writeAuditEvent(app.database, {
      organizationId: workspace?.organizationId ?? null,
      actorType: 'user',
      actorId: principal.userId,
      action: 'system.archive',
      entityType: 'system',
      entityId: system.id,
      ipAddress: request.ip,
    });

    const tagMap = await getSystemTags(app.database, [system.id]);
    return {
      system: archived ? toPublicSystem(archived, tagMap.get(archived.id) ?? []) : null,
    };
  });

  /** Permanent delete — linked records/imports keep rows but lose systemId. */
  app.post('/api/v1/systems/:systemId/purge', async (request, reply) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    const params = z.object({ systemId: z.string().uuid() }).parse(request.params);
    z.object({ confirmDestroy: z.literal(true) }).parse(request.body ?? {});

    const [system] = await app.database.db
      .select()
      .from(systems)
      .where(eq(systems.id, params.systemId))
      .limit(1);

    if (!system) {
      throw new AppError({
        code: 'SYSTEM_NOT_FOUND',
        message: 'System not found',
        statusCode: 404,
      });
    }

    requireWorkspaceAdmin(principal, system.workspaceId);

    const [workspace] = await app.database.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, system.workspaceId))
      .limit(1);

    await app.database.db.delete(systems).where(eq(systems.id, system.id));

    await writeAuditEvent(app.database, {
      organizationId: workspace?.organizationId ?? null,
      actorType: 'user',
      actorId: principal.userId,
      action: 'system.purge',
      entityType: 'system',
      entityId: system.id,
      metadata: { name: system.name, slug: system.slug },
      ipAddress: request.ip,
    });

    return reply.status(204).send();
  });
}
