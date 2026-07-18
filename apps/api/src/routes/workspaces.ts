import type { FastifyInstance } from 'fastify';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { slugify } from '@project-knowledge-hub/auth';
import { memberships, workspaces } from '@project-knowledge-hub/database';
import { AppError } from '@project-knowledge-hub/domain';
import {
  requireSystemAdmin,
  requireWorkspaceAdmin,
  requireWorkspaceView,
} from '@project-knowledge-hub/permissions';
import {
  assertMutatingOrigin,
  requireAuthenticated,
} from '../plugins/auth.js';
import {
  getDefaultOrganization,
  toPublicWorkspace,
  writeAuditEvent,
} from '../lib/identity.js';

const createWorkspaceSchema = z.object({
  name: z.string().min(1).max(120),
  slug: z.string().min(1).max(64).optional(),
  description: z.string().max(2000).optional(),
});

const updateWorkspaceSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).nullable().optional(),
  archived: z.boolean().optional(),
});

export async function registerWorkspaceRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/workspaces', async (request) => {
    const principal = requireAuthenticated(request);

    if (principal.isSystemAdmin) {
      const rows = await app.database.db
        .select()
        .from(workspaces)
        .where(isNull(workspaces.archivedAt));
      return { workspaces: rows.map(toPublicWorkspace) };
    }

    const accessibleIds = principal.memberships.map((membership) => membership.workspaceId);
    if (accessibleIds.length === 0) {
      return { workspaces: [] };
    }

    const rows = await app.database.db
      .select()
      .from(workspaces)
      .where(and(inArray(workspaces.id, accessibleIds), isNull(workspaces.archivedAt)));

    return { workspaces: rows.map(toPublicWorkspace) };
  });

  app.post('/api/v1/workspaces', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);

    const body = createWorkspaceSchema.parse(request.body);
    const organization = await getDefaultOrganization(app.database);
    if (!organization) {
      throw new AppError({
        code: 'ORGANIZATION_MISSING',
        message: 'Default organization is not seeded',
        statusCode: 500,
      });
    }

    const slug = body.slug ? slugify(body.slug) : slugify(body.name);
    if (!slug) {
      throw new AppError({
        code: 'VALIDATION_ERROR',
        message: 'Workspace slug is invalid',
        statusCode: 400,
      });
    }

    const [existing] = await app.database.db
      .select()
      .from(workspaces)
      .where(
        and(eq(workspaces.organizationId, organization.id), eq(workspaces.slug, slug)),
      )
      .limit(1);

    if (existing) {
      throw new AppError({
        code: 'WORKSPACE_SLUG_CONFLICT',
        message: 'A workspace with this slug already exists',
        statusCode: 409,
      });
    }

    const [created] = await app.database.db
      .insert(workspaces)
      .values({
        organizationId: organization.id,
        name: body.name,
        slug,
        description: body.description ?? null,
        updatedAt: new Date(),
      })
      .returning();

    if (!created) {
      throw new AppError({
        code: 'WORKSPACE_CREATE_FAILED',
        message: 'Failed to create workspace',
        statusCode: 500,
      });
    }

    await app.database.db.insert(memberships).values({
      userId: principal.userId,
      workspaceId: created.id,
      role: 'workspace_admin',
    });

    await writeAuditEvent(app.database, {
      organizationId: organization.id,
      actorType: 'user',
      actorId: principal.userId,
      action: 'workspace.create',
      entityType: 'workspace',
      entityId: created.id,
      metadata: { slug: created.slug, name: created.name },
      ipAddress: request.ip,
    });

    return { workspace: toPublicWorkspace(created) };
  });

  app.get('/api/v1/workspaces/:workspaceId', async (request) => {
    const principal = requireAuthenticated(request);
    const params = z.object({ workspaceId: z.string().uuid() }).parse(request.params);
    requireWorkspaceView(principal, params.workspaceId);

    const [workspace] = await app.database.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, params.workspaceId))
      .limit(1);

    if (!workspace || workspace.archivedAt) {
      throw new AppError({
        code: 'WORKSPACE_NOT_FOUND',
        message: 'Workspace not found',
        statusCode: 404,
      });
    }

    return { workspace: toPublicWorkspace(workspace) };
  });

  app.patch('/api/v1/workspaces/:workspaceId', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    const params = z.object({ workspaceId: z.string().uuid() }).parse(request.params);
    requireWorkspaceAdmin(principal, params.workspaceId);

    const body = updateWorkspaceSchema.parse(request.body);
    const [workspace] = await app.database.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, params.workspaceId))
      .limit(1);

    if (!workspace) {
      throw new AppError({
        code: 'WORKSPACE_NOT_FOUND',
        message: 'Workspace not found',
        statusCode: 404,
      });
    }

    const [updated] = await app.database.db
      .update(workspaces)
      .set({
        name: body.name ?? workspace.name,
        description:
          body.description === undefined ? workspace.description : body.description,
        archivedAt:
          body.archived === undefined
            ? workspace.archivedAt
            : body.archived
              ? new Date()
              : null,
        updatedAt: new Date(),
      })
      .where(eq(workspaces.id, params.workspaceId))
      .returning();

    if (!updated) {
      throw new AppError({
        code: 'WORKSPACE_UPDATE_FAILED',
        message: 'Failed to update workspace',
        statusCode: 500,
      });
    }

    await writeAuditEvent(app.database, {
      organizationId: workspace.organizationId,
      actorType: 'user',
      actorId: principal.userId,
      action: 'workspace.update',
      entityType: 'workspace',
      entityId: workspace.id,
      metadata: body,
      ipAddress: request.ip,
    });

    return { workspace: toPublicWorkspace(updated) };
  });

  app.delete('/api/v1/workspaces/:workspaceId', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    const params = z.object({ workspaceId: z.string().uuid() }).parse(request.params);
    requireWorkspaceAdmin(principal, params.workspaceId);

    const [workspace] = await app.database.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, params.workspaceId))
      .limit(1);

    if (!workspace || workspace.archivedAt) {
      throw new AppError({
        code: 'WORKSPACE_NOT_FOUND',
        message: 'Workspace not found',
        statusCode: 404,
      });
    }

    const [archived] = await app.database.db
      .update(workspaces)
      .set({
        archivedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(workspaces.id, params.workspaceId))
      .returning();

    await writeAuditEvent(app.database, {
      organizationId: workspace.organizationId,
      actorType: 'user',
      actorId: principal.userId,
      action: 'workspace.archive',
      entityType: 'workspace',
      entityId: workspace.id,
      ipAddress: request.ip,
    });

    return { workspace: archived ? toPublicWorkspace(archived) : null };
  });
}
