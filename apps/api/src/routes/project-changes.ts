import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { workspaces } from '@project-knowledge-hub/database';
import {
  changeDeliveryEntityTypeSchema,
  changeKindSchema,
  changeStatusSchema,
} from '@project-knowledge-hub/domain';
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
  assertProjectNotArchived,
  requireProjectContext,
} from '../lib/project-delivery.js';
import {
  createChangeItem,
  deleteChangeItem,
  getChangeItem,
  listChangeItems,
  updateChangeItem,
} from '../lib/project-changes.js';

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

const dateStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable();

const deliveryLinkSchema = z.object({
  entityType: changeDeliveryEntityTypeSchema,
  entityId: z.string().uuid(),
});

const createSchema = z.object({
  kind: changeKindSchema,
  title: z.string().min(1).max(300),
  description: z.string().max(10000).nullable().optional(),
  rationale: z.string().max(10000).nullable().optional(),
  status: changeStatusSchema.optional(),
  requestedByUserId: z.string().uuid().nullable().optional(),
  approvedByUserId: z.string().uuid().nullable().optional(),
  effectiveDate: dateStringSchema.optional(),
  baselineStartBefore: dateStringSchema.optional(),
  baselineStartAfter: dateStringSchema.optional(),
  baselineEndBefore: dateStringSchema.optional(),
  baselineEndAfter: dateStringSchema.optional(),
  knowledgeRecordId: z.string().uuid().nullable().optional(),
  sortOrder: z.number().int().min(0).max(100000).optional(),
  deliveryLinks: z.array(deliveryLinkSchema).max(200).optional(),
});

const updateSchema = createSchema.partial().extend({
  archived: z.boolean().optional(),
});

export async function registerProjectChangeRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get('/api/v1/projects/:projectId/change-items', async (request) => {
    const principal = requireAuthenticated(request);
    const params = z.object({ projectId: z.string().uuid() }).parse(request.params);
    const query = z
      .object({
        includeArchived: z
          .enum(['true', 'false'])
          .optional()
          .transform((value) => value === 'true'),
      })
      .parse(request.query);
    const { project } = await requireProjectContext(app.database, params.projectId);
    requireWorkspaceView(principal, project.workspaceId);
    return {
      changeItems: await listChangeItems(app.database, project.id, {
        includeArchived: query.includeArchived,
      }),
    };
  });

  app.post('/api/v1/projects/:projectId/change-items', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    const params = z.object({ projectId: z.string().uuid() }).parse(request.params);
    const body = createSchema.parse(request.body);
    const { project } = await requireProjectContext(app.database, params.projectId);
    requireWorkspaceMaintainer(principal, project.workspaceId);
    assertProjectNotArchived(project);

    const changeItem = await createChangeItem(app.database, {
      projectId: project.id,
      workspaceId: project.workspaceId,
      ...body,
      requestedByUserId: body.requestedByUserId ?? principal.userId,
    });

    await writeAuditEvent(app.database, {
      organizationId: await workspaceOrgId(app, project.workspaceId),
      actorType: 'user',
      actorId: principal.userId,
      action: 'project.change_item_created',
      entityType: 'project_change_item',
      entityId: changeItem.id,
      metadata: {
        projectId: project.id,
        kind: changeItem.kind,
        title: changeItem.title,
      },
      ipAddress: request.ip,
    });

    return { changeItem };
  });

  app.get('/api/v1/project-change-items/:changeId', async (request) => {
    const principal = requireAuthenticated(request);
    const params = z.object({ changeId: z.string().uuid() }).parse(request.params);
    const changeItem = await getChangeItem(app.database, params.changeId);
    const { project } = await requireProjectContext(
      app.database,
      changeItem.projectId,
    );
    requireWorkspaceView(principal, project.workspaceId);
    return { changeItem };
  });

  app.patch('/api/v1/project-change-items/:changeId', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    const params = z.object({ changeId: z.string().uuid() }).parse(request.params);
    const body = updateSchema.parse(request.body);
    const existing = await getChangeItem(app.database, params.changeId);
    const { project } = await requireProjectContext(
      app.database,
      existing.projectId,
    );
    requireWorkspaceMaintainer(principal, project.workspaceId);
    assertProjectNotArchived(project);

    const changeItem = await updateChangeItem(app.database, params.changeId, {
      workspaceId: project.workspaceId,
      ...body,
    });

    await writeAuditEvent(app.database, {
      organizationId: await workspaceOrgId(app, project.workspaceId),
      actorType: 'user',
      actorId: principal.userId,
      action: 'project.change_item_updated',
      entityType: 'project_change_item',
      entityId: changeItem.id,
      metadata: { projectId: project.id, ...body },
      ipAddress: request.ip,
    });

    return { changeItem };
  });

  app.delete('/api/v1/project-change-items/:changeId', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    const params = z.object({ changeId: z.string().uuid() }).parse(request.params);
    const existing = await getChangeItem(app.database, params.changeId);
    const { project } = await requireProjectContext(
      app.database,
      existing.projectId,
    );
    requireWorkspaceMaintainer(principal, project.workspaceId);
    assertProjectNotArchived(project);

    const deleted = await deleteChangeItem(app.database, params.changeId);

    await writeAuditEvent(app.database, {
      organizationId: await workspaceOrgId(app, project.workspaceId),
      actorType: 'user',
      actorId: principal.userId,
      action: 'project.change_item_deleted',
      entityType: 'project_change_item',
      entityId: deleted.id,
      metadata: {
        projectId: project.id,
        kind: existing.kind,
        title: existing.title,
      },
      ipAddress: request.ip,
    });

    return { ok: true };
  });
}
