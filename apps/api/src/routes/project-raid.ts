import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { workspaces } from '@project-knowledge-hub/database';
import {
  raidKindSchema,
  raidSeveritySchema,
  raidStatusSchema,
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
  getTask,
  requireProjectContext,
} from '../lib/project-delivery.js';
import {
  createRaidItem,
  deleteRaidItem,
  getRaidItem,
  listRaidItems,
  listRaidItemsForTask,
  setRaidTaskLinks,
  transferRaidItem,
  updateRaidItem,
} from '../lib/project-raid.js';

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

const createSchema = z.object({
  kind: raidKindSchema,
  title: z.string().min(1).max(300),
  description: z.string().max(10000).nullable().optional(),
  status: raidStatusSchema.optional(),
  severity: raidSeveritySchema.optional(),
  ownerUserId: z.string().uuid().nullable().optional(),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  sortOrder: z.number().int().min(0).max(100000).optional(),
  taskIds: z.array(z.string().uuid()).max(100).optional(),
});

const updateSchema = z.object({
  kind: raidKindSchema.optional(),
  title: z.string().min(1).max(300).optional(),
  description: z.string().max(10000).nullable().optional(),
  status: raidStatusSchema.optional(),
  severity: raidSeveritySchema.optional(),
  ownerUserId: z.string().uuid().nullable().optional(),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  sortOrder: z.number().int().min(0).max(100000).optional(),
  archived: z.boolean().optional(),
});

const taskLinksSchema = z.object({
  taskIds: z.array(z.string().uuid()).max(100),
});

const transferSchema = z.object({
  targetKind: z.enum(['issue', 'risk']),
});

export async function registerProjectRaidRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get('/api/v1/projects/:projectId/raid-items', async (request) => {
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
      raidItems: await listRaidItems(app.database, project.id, {
        includeArchived: query.includeArchived,
      }),
    };
  });

  app.post('/api/v1/projects/:projectId/raid-items', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    const params = z.object({ projectId: z.string().uuid() }).parse(request.params);
    const body = createSchema.parse(request.body);
    const { project } = await requireProjectContext(app.database, params.projectId);
    requireWorkspaceMaintainer(principal, project.workspaceId);
    assertProjectNotArchived(project);

    const raidItem = await createRaidItem(app.database, {
      projectId: project.id,
      workspaceId: project.workspaceId,
      ...body,
    });

    await writeAuditEvent(app.database, {
      organizationId: await workspaceOrgId(app, project.workspaceId),
      actorType: 'user',
      actorId: principal.userId,
      action: 'project.raid_item_created',
      entityType: 'project_raid_item',
      entityId: raidItem.id,
      metadata: {
        projectId: project.id,
        kind: raidItem.kind,
        title: raidItem.title,
      },
      ipAddress: request.ip,
    });

    return { raidItem };
  });

  app.get('/api/v1/project-raid-items/:raidItemId', async (request) => {
    const principal = requireAuthenticated(request);
    const params = z
      .object({ raidItemId: z.string().uuid() })
      .parse(request.params);
    const raidItem = await getRaidItem(app.database, params.raidItemId);
    const { project } = await requireProjectContext(app.database, raidItem.projectId);
    requireWorkspaceView(principal, project.workspaceId);
    return { raidItem };
  });

  app.patch('/api/v1/project-raid-items/:raidItemId', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    const params = z
      .object({ raidItemId: z.string().uuid() })
      .parse(request.params);
    const body = updateSchema.parse(request.body);

    const existing = await getRaidItem(app.database, params.raidItemId);
    const { project } = await requireProjectContext(app.database, existing.projectId);
    requireWorkspaceMaintainer(principal, project.workspaceId);
    assertProjectNotArchived(project);

    const raidItem = await updateRaidItem(app.database, params.raidItemId, {
      workspaceId: project.workspaceId,
      ...body,
    });

    await writeAuditEvent(app.database, {
      organizationId: await workspaceOrgId(app, project.workspaceId),
      actorType: 'user',
      actorId: principal.userId,
      action: 'project.raid_item_updated',
      entityType: 'project_raid_item',
      entityId: raidItem.id,
      metadata: { projectId: project.id, ...body },
      ipAddress: request.ip,
    });

    return { raidItem };
  });

  app.delete('/api/v1/project-raid-items/:raidItemId', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    const params = z
      .object({ raidItemId: z.string().uuid() })
      .parse(request.params);

    const existing = await getRaidItem(app.database, params.raidItemId);
    const { project } = await requireProjectContext(app.database, existing.projectId);
    requireWorkspaceMaintainer(principal, project.workspaceId);
    assertProjectNotArchived(project);

    const deleted = await deleteRaidItem(app.database, params.raidItemId);

    await writeAuditEvent(app.database, {
      organizationId: await workspaceOrgId(app, project.workspaceId),
      actorType: 'user',
      actorId: principal.userId,
      action: 'project.raid_item_deleted',
      entityType: 'project_raid_item',
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

  app.post(
    '/api/v1/project-raid-items/:raidItemId/transfer',
    async (request) => {
      assertMutatingOrigin(app, request);
      const principal = requireAuthenticated(request);
      const params = z
        .object({ raidItemId: z.string().uuid() })
        .parse(request.params);
      const body = transferSchema.parse(request.body);

      const existing = await getRaidItem(app.database, params.raidItemId);
      const { project } = await requireProjectContext(
        app.database,
        existing.projectId,
      );
      requireWorkspaceMaintainer(principal, project.workspaceId);
      assertProjectNotArchived(project);

      const result = await transferRaidItem(
        app.database,
        params.raidItemId,
        body.targetKind,
      );

      await writeAuditEvent(app.database, {
        organizationId: await workspaceOrgId(app, project.workspaceId),
        actorType: 'user',
        actorId: principal.userId,
        action:
          body.targetKind === 'issue'
            ? 'raid.transferred_to_issue'
            : 'raid.transferred_to_risk',
        entityType: 'project_raid_item',
        entityId: result.source.id,
        metadata: {
          projectId: project.id,
          sourceId: result.source.id,
          sourceHumanKey: result.source.humanKey,
          targetId: result.target.id,
          targetHumanKey: result.target.humanKey,
          targetKind: body.targetKind,
        },
        ipAddress: request.ip,
      });

      return result;
    },
  );

  app.put('/api/v1/project-raid-items/:raidItemId/tasks', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    const params = z
      .object({ raidItemId: z.string().uuid() })
      .parse(request.params);
    const body = taskLinksSchema.parse(request.body);

    const existing = await getRaidItem(app.database, params.raidItemId);
    const { project } = await requireProjectContext(app.database, existing.projectId);
    requireWorkspaceMaintainer(principal, project.workspaceId);
    assertProjectNotArchived(project);

    const raidItem = await setRaidTaskLinks(app.database, {
      raidItemId: params.raidItemId,
      projectId: project.id,
      taskIds: body.taskIds,
    });

    await writeAuditEvent(app.database, {
      organizationId: await workspaceOrgId(app, project.workspaceId),
      actorType: 'user',
      actorId: principal.userId,
      action: 'project.raid_task_links_set',
      entityType: 'project_raid_item',
      entityId: raidItem.id,
      metadata: {
        projectId: project.id,
        taskIds: body.taskIds,
      },
      ipAddress: request.ip,
    });

    return { raidItem };
  });

  app.get('/api/v1/project-tasks/:taskId/raid-items', async (request) => {
    const principal = requireAuthenticated(request);
    const params = z.object({ taskId: z.string().uuid() }).parse(request.params);
    const task = await getTask(app.database, params.taskId);
    const { project } = await requireProjectContext(app.database, task.projectId);
    requireWorkspaceView(principal, project.workspaceId);

    return {
      raidItems: await listRaidItemsForTask(app.database, params.taskId),
    };
  });
}
