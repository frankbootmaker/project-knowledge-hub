import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { workspaces } from '@project-knowledge-hub/database';
import {
  milestoneStatusSchema,
  raciRoleSchema,
  taskStatusSchema,
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
  createMilestone,
  createTask,
  deleteTask,
  getMilestone,
  getTask,
  listMilestones,
  listTasks,
  replaceTaskRaci,
  requireProjectContext,
  updateMilestone,
  updateTask,
} from '../lib/project-delivery.js';

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
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
  .nullable();

const raciEntrySchema = z.object({
  userId: z.string().uuid(),
  role: raciRoleSchema,
});

const createMilestoneSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(5000).nullable().optional(),
  status: milestoneStatusSchema.optional(),
  targetDate: dateStringSchema.optional(),
  sortOrder: z.number().int().min(0).max(100000).optional(),
});

const updateMilestoneSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).nullable().optional(),
  status: milestoneStatusSchema.optional(),
  targetDate: dateStringSchema.optional(),
  sortOrder: z.number().int().min(0).max(100000).optional(),
  archived: z.boolean().optional(),
});

const createTaskSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(10000).nullable().optional(),
  status: taskStatusSchema.optional(),
  dueDate: dateStringSchema.optional(),
  milestoneId: z.string().uuid().nullable().optional(),
  userStoryId: z.string().uuid().nullable().optional(),
  currentOwnerUserId: z.string().uuid().nullable().optional(),
  sortOrder: z.number().int().min(0).max(100000).optional(),
  raci: z.array(raciEntrySchema).max(50).optional(),
});

const updateTaskSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(10000).nullable().optional(),
  status: taskStatusSchema.optional(),
  dueDate: dateStringSchema.optional(),
  milestoneId: z.string().uuid().nullable().optional(),
  userStoryId: z.string().uuid().nullable().optional(),
  currentOwnerUserId: z.string().uuid().nullable().optional(),
  sortOrder: z.number().int().min(0).max(100000).optional(),
  archived: z.boolean().optional(),
});

const replaceRaciSchema = z.object({
  entries: z.array(raciEntrySchema).max(50),
});

export async function registerProjectDeliveryRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get('/api/v1/projects/:projectId/milestones', async (request) => {
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
      milestones: await listMilestones(app.database, project.id, {
        includeArchived: query.includeArchived,
      }),
    };
  });

  app.post('/api/v1/projects/:projectId/milestones', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    const params = z.object({ projectId: z.string().uuid() }).parse(request.params);
    const body = createMilestoneSchema.parse(request.body);

    const { project } = await requireProjectContext(app.database, params.projectId);
    requireWorkspaceMaintainer(principal, project.workspaceId);
    assertProjectNotArchived(project);

    const milestone = await createMilestone(app.database, {
      projectId: project.id,
      ...body,
    });

    await writeAuditEvent(app.database, {
      organizationId: await workspaceOrgId(app, project.workspaceId),
      actorType: 'user',
      actorId: principal.userId,
      action: 'project.milestone_created',
      entityType: 'project_milestone',
      entityId: milestone.id,
      metadata: { projectId: project.id, title: milestone.title },
      ipAddress: request.ip,
    });

    return { milestone };
  });

  app.patch('/api/v1/project-milestones/:milestoneId', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    const params = z.object({ milestoneId: z.string().uuid() }).parse(request.params);
    const body = updateMilestoneSchema.parse(request.body);

    const existing = await getMilestone(app.database, params.milestoneId);
    const { project } = await requireProjectContext(app.database, existing.projectId);
    requireWorkspaceMaintainer(principal, project.workspaceId);
    assertProjectNotArchived(project);

    const milestone = await updateMilestone(app.database, params.milestoneId, body);

    await writeAuditEvent(app.database, {
      organizationId: await workspaceOrgId(app, project.workspaceId),
      actorType: 'user',
      actorId: principal.userId,
      action: 'project.milestone_updated',
      entityType: 'project_milestone',
      entityId: milestone.id,
      metadata: { projectId: project.id, ...body },
      ipAddress: request.ip,
    });

    return { milestone };
  });

  app.get('/api/v1/projects/:projectId/tasks', async (request) => {
    const principal = requireAuthenticated(request);
    const params = z.object({ projectId: z.string().uuid() }).parse(request.params);
    const query = z
      .object({
        milestoneId: z.string().uuid().optional(),
        unassignedMilestone: z
          .enum(['true', 'false'])
          .optional()
          .transform((value) => value === 'true'),
        includeArchived: z
          .enum(['true', 'false'])
          .optional()
          .transform((value) => value === 'true'),
      })
      .parse(request.query);

    const { project } = await requireProjectContext(app.database, params.projectId);
    requireWorkspaceView(principal, project.workspaceId);

    const milestoneId = query.unassignedMilestone
      ? null
      : query.milestoneId;

    return {
      tasks: await listTasks(app.database, project.id, {
        milestoneId,
        includeArchived: query.includeArchived,
      }),
    };
  });

  app.post('/api/v1/projects/:projectId/tasks', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    const params = z.object({ projectId: z.string().uuid() }).parse(request.params);
    const body = createTaskSchema.parse(request.body);

    const { project } = await requireProjectContext(app.database, params.projectId);
    requireWorkspaceMaintainer(principal, project.workspaceId);
    assertProjectNotArchived(project);

    const task = await createTask(app.database, {
      projectId: project.id,
      workspaceId: project.workspaceId,
      createdBy: principal.userId,
      ...body,
    });

    await writeAuditEvent(app.database, {
      organizationId: await workspaceOrgId(app, project.workspaceId),
      actorType: 'user',
      actorId: principal.userId,
      action: 'project.task_created',
      entityType: 'project_task',
      entityId: task.id,
      metadata: { projectId: project.id, title: task.title },
      ipAddress: request.ip,
    });

    return { task };
  });

  app.get('/api/v1/project-tasks/:taskId', async (request) => {
    const principal = requireAuthenticated(request);
    const params = z.object({ taskId: z.string().uuid() }).parse(request.params);

    const task = await getTask(app.database, params.taskId);
    const { project } = await requireProjectContext(app.database, task.projectId);
    requireWorkspaceView(principal, project.workspaceId);

    return { task };
  });

  app.patch('/api/v1/project-tasks/:taskId', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    const params = z.object({ taskId: z.string().uuid() }).parse(request.params);
    const body = updateTaskSchema.parse(request.body);

    const existing = await getTask(app.database, params.taskId);
    const { project } = await requireProjectContext(app.database, existing.projectId);
    requireWorkspaceMaintainer(principal, project.workspaceId);
    assertProjectNotArchived(project);

    const task = await updateTask(app.database, params.taskId, {
      ...body,
      actorUserId: principal.userId,
      workspaceId: project.workspaceId,
    });

    await writeAuditEvent(app.database, {
      organizationId: await workspaceOrgId(app, project.workspaceId),
      actorType: 'user',
      actorId: principal.userId,
      action: 'project.task_updated',
      entityType: 'project_task',
      entityId: task.id,
      metadata: { projectId: project.id, ...body },
      ipAddress: request.ip,
    });

    return { task };
  });

  app.delete('/api/v1/project-tasks/:taskId', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    const params = z.object({ taskId: z.string().uuid() }).parse(request.params);

    const existing = await getTask(app.database, params.taskId);
    const { project } = await requireProjectContext(app.database, existing.projectId);
    requireWorkspaceMaintainer(principal, project.workspaceId);
    assertProjectNotArchived(project);

    const deleted = await deleteTask(app.database, params.taskId);

    await writeAuditEvent(app.database, {
      organizationId: await workspaceOrgId(app, project.workspaceId),
      actorType: 'user',
      actorId: principal.userId,
      action: 'project.task_deleted',
      entityType: 'project_task',
      entityId: deleted.id,
      metadata: { projectId: project.id, title: existing.title },
      ipAddress: request.ip,
    });

    return { ok: true };
  });

  app.put('/api/v1/project-tasks/:taskId/raci', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    const params = z.object({ taskId: z.string().uuid() }).parse(request.params);
    const body = replaceRaciSchema.parse(request.body);

    const existing = await getTask(app.database, params.taskId);
    const { project } = await requireProjectContext(app.database, existing.projectId);
    requireWorkspaceMaintainer(principal, project.workspaceId);
    assertProjectNotArchived(project);

    const raci = await replaceTaskRaci(app.database, {
      taskId: params.taskId,
      workspaceId: project.workspaceId,
      entries: body.entries,
      actorUserId: principal.userId,
    });
    const task = await getTask(app.database, params.taskId);

    await writeAuditEvent(app.database, {
      organizationId: await workspaceOrgId(app, project.workspaceId),
      actorType: 'user',
      actorId: principal.userId,
      action: 'project.task_raci_set',
      entityType: 'project_task',
      entityId: task.id,
      metadata: { projectId: project.id, entries: body.entries },
      ipAddress: request.ip,
    });

    return { task, raci };
  });
}
