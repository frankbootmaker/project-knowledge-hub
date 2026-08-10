import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { workspaces } from '@project-knowledge-hub/database';
import { projectStakeholderRoleSchema } from '@project-knowledge-hub/domain';
import {
  requireWorkspaceMaintainer,
  requireWorkspaceView,
} from '@project-knowledge-hub/permissions';
import {
  assertMutatingOrigin,
  requireAuthenticated,
} from '../plugins/auth.js';
import { writeAuditEvent } from '../lib/identity.js';
import { requireProjectContext } from '../lib/project-delivery.js';
import {
  deleteProjectStakeholder,
  getRosterStakeholder,
  listProjectStakeholders,
  updateProjectStakeholder,
  upsertProjectStakeholder,
} from '../lib/project-stakeholders.js';

async function workspaceOrgId(
  app: FastifyInstance,
  workspaceId: string,
): Promise<string | null> {
  const [workspace] = await app.database.db
    .select({ organizationId: workspaces.organizationId })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  return workspace?.organizationId ?? null;
}

const upsertSchema = z.object({
  userId: z.string().uuid(),
  projectRole: projectStakeholderRoleSchema,
  jobTitle: z.string().max(200).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  reportsToUserId: z.string().uuid().nullable().optional(),
  sortOrder: z.number().int().min(0).max(100000).optional(),
});

const updateSchema = z.object({
  projectRole: projectStakeholderRoleSchema.optional(),
  jobTitle: z.string().max(200).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  reportsToUserId: z.string().uuid().nullable().optional(),
  sortOrder: z.number().int().min(0).max(100000).optional(),
});

export async function registerProjectStakeholderRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get('/api/v1/projects/:projectId/stakeholders', async (request) => {
    const principal = requireAuthenticated(request);
    const params = z.object({ projectId: z.string().uuid() }).parse(request.params);
    const { project } = await requireProjectContext(app.database, params.projectId);
    requireWorkspaceView(principal, project.workspaceId);

    return {
      stakeholders: await listProjectStakeholders(app.database, project.id),
    };
  });

  app.post('/api/v1/projects/:projectId/stakeholders', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    const params = z.object({ projectId: z.string().uuid() }).parse(request.params);
    const body = upsertSchema.parse(request.body);
    const { project } = await requireProjectContext(app.database, params.projectId);
    requireWorkspaceMaintainer(principal, project.workspaceId);

    const stakeholder = await upsertProjectStakeholder(app.database, {
      projectId: project.id,
      workspaceId: project.workspaceId,
      userId: body.userId,
      projectRole: body.projectRole,
      jobTitle: body.jobTitle,
      notes: body.notes,
      reportsToUserId: body.reportsToUserId,
      sortOrder: body.sortOrder,
    });

    await writeAuditEvent(app.database, {
      organizationId: await workspaceOrgId(app, project.workspaceId),
      actorType: 'user',
      actorId: principal.userId,
      action: 'project.stakeholder_upserted',
      entityType: 'project_stakeholder',
      entityId: stakeholder.rosterId ?? stakeholder.userId,
      metadata: {
        projectId: project.id,
        userId: stakeholder.userId,
        projectRole: stakeholder.projectRole,
      },
      ipAddress: request.ip,
    });

    return { stakeholder };
  });

  app.patch('/api/v1/project-stakeholders/:stakeholderId', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    const params = z
      .object({ stakeholderId: z.string().uuid() })
      .parse(request.params);
    const body = updateSchema.parse(request.body);

    const existing = await getRosterStakeholder(app.database, params.stakeholderId);
    const { project } = await requireProjectContext(app.database, existing.projectId);
    requireWorkspaceMaintainer(principal, project.workspaceId);

    const stakeholder = await updateProjectStakeholder(
      app.database,
      params.stakeholderId,
      body,
    );

    await writeAuditEvent(app.database, {
      organizationId: await workspaceOrgId(app, project.workspaceId),
      actorType: 'user',
      actorId: principal.userId,
      action: 'project.stakeholder_updated',
      entityType: 'project_stakeholder',
      entityId: params.stakeholderId,
      metadata: { projectId: project.id, userId: stakeholder.userId },
      ipAddress: request.ip,
    });

    return { stakeholder };
  });

  app.delete('/api/v1/project-stakeholders/:stakeholderId', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    const params = z
      .object({ stakeholderId: z.string().uuid() })
      .parse(request.params);

    const existing = await getRosterStakeholder(app.database, params.stakeholderId);
    const { project } = await requireProjectContext(app.database, existing.projectId);
    requireWorkspaceMaintainer(principal, project.workspaceId);

    const deleted = await deleteProjectStakeholder(
      app.database,
      params.stakeholderId,
    );

    await writeAuditEvent(app.database, {
      organizationId: await workspaceOrgId(app, project.workspaceId),
      actorType: 'user',
      actorId: principal.userId,
      action: 'project.stakeholder_deleted',
      entityType: 'project_stakeholder',
      entityId: params.stakeholderId,
      metadata: { projectId: deleted.projectId, userId: deleted.userId },
      ipAddress: request.ip,
    });

    return { ok: true, ...deleted };
  });
}
