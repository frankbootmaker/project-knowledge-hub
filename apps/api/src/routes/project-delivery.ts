import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { workspaces } from '@project-knowledge-hub/database';
import {
  AppError,
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
import { knowledgeExportFilename } from '../lib/knowledge-export.js';
import { listEpics, listUserStories } from '../lib/project-agile.js';
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
import {
  parseHours,
  upsertProjectCostSnapshot,
} from '../lib/project-budget.js';
import { buildBoardPdf } from '../lib/board-export.js';
import { buildCalendarPdf } from '../lib/calendar-export.js';
import { buildTimelinePdf } from '../lib/timeline-export.js';

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
  startDate: dateStringSchema.optional(),
  targetDate: dateStringSchema.optional(),
  sortOrder: z.number().int().min(0).max(100000).optional(),
});

const updateMilestoneSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).nullable().optional(),
  status: milestoneStatusSchema.optional(),
  startDate: dateStringSchema.optional(),
  targetDate: dateStringSchema.optional(),
  sortOrder: z.number().int().min(0).max(100000).optional(),
  archived: z.boolean().optional(),
});

const hoursSchema = z.union([z.number(), z.string()]).nullable();

const createTaskSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(10000).nullable().optional(),
  status: taskStatusSchema.optional(),
  dueDate: dateStringSchema.optional(),
  forecastHours: hoursSchema.optional(),
  actualHours: hoursSchema.optional(),
  tokensUsed: z.number().int().min(0).nullable().optional(),
  aiSystemId: z.string().uuid().nullable().optional(),
  milestoneId: z.string().uuid().nullable().optional(),
  userStoryId: z.string().uuid().nullable().optional(),
  sprintId: z.string().uuid().nullable().optional(),
  storyPoints: z.number().int().min(0).max(1000).nullable().optional(),
  currentOwnerUserId: z.string().uuid().nullable().optional(),
  sortOrder: z.number().int().min(0).max(100000).optional(),
  raci: z.array(raciEntrySchema).max(50).optional(),
});

const updateTaskSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(10000).nullable().optional(),
  status: taskStatusSchema.optional(),
  dueDate: dateStringSchema.optional(),
  forecastHours: hoursSchema.optional(),
  actualHours: hoursSchema.optional(),
  tokensUsed: z.number().int().min(0).nullable().optional(),
  aiSystemId: z.string().uuid().nullable().optional(),
  milestoneId: z.string().uuid().nullable().optional(),
  userStoryId: z.string().uuid().nullable().optional(),
  sprintId: z.string().uuid().nullable().optional(),
  storyPoints: z.number().int().min(0).max(1000).nullable().optional(),
  currentOwnerUserId: z.string().uuid().nullable().optional(),
  sortOrder: z.number().int().min(0).max(100000).optional(),
  archived: z.boolean().optional(),
});

const reportAiUsageSchema = z.object({
  tokensUsed: z.number().int().min(0),
  aiSystemId: z.string().uuid().nullable().optional(),
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
        sprintId: z.string().uuid().optional(),
        unassignedSprint: z
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
    const sprintId = query.unassignedSprint ? null : query.sprintId;

    return {
      tasks: await listTasks(app.database, project.id, {
        milestoneId,
        sprintId,
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
      title: body.title,
      description: body.description,
      status: body.status,
      dueDate: body.dueDate,
      forecastHours:
        body.forecastHours === undefined
          ? undefined
          : parseHours(body.forecastHours) ?? null,
      actualHours:
        body.actualHours === undefined
          ? undefined
          : parseHours(body.actualHours) ?? null,
      tokensUsed: body.tokensUsed,
      aiSystemId: body.aiSystemId,
      milestoneId: body.milestoneId,
      userStoryId: body.userStoryId,
      sprintId: body.sprintId,
      storyPoints: body.storyPoints,
      currentOwnerUserId: body.currentOwnerUserId,
      sortOrder: body.sortOrder,
      raci: body.raci,
    });

    if (
      body.forecastHours !== undefined ||
      body.actualHours !== undefined ||
      body.tokensUsed !== undefined ||
      body.aiSystemId !== undefined
    ) {
      await upsertProjectCostSnapshot(app.database, project.id);
    }

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
      title: body.title,
      description: body.description,
      status: body.status,
      dueDate: body.dueDate,
      forecastHours:
        body.forecastHours === undefined
          ? undefined
          : parseHours(body.forecastHours) ?? null,
      actualHours:
        body.actualHours === undefined
          ? undefined
          : parseHours(body.actualHours) ?? null,
      tokensUsed: body.tokensUsed,
      aiSystemId: body.aiSystemId,
      milestoneId: body.milestoneId,
      userStoryId: body.userStoryId,
      sprintId: body.sprintId,
      storyPoints: body.storyPoints,
      currentOwnerUserId: body.currentOwnerUserId,
      sortOrder: body.sortOrder,
      archived: body.archived,
      actorUserId: principal.userId,
      workspaceId: project.workspaceId,
    });

    if (
      body.forecastHours !== undefined ||
      body.actualHours !== undefined ||
      body.tokensUsed !== undefined ||
      body.aiSystemId !== undefined
    ) {
      await upsertProjectCostSnapshot(app.database, project.id);
    }

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

  app.post('/api/v1/project-tasks/:taskId/ai-usage', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    const params = z.object({ taskId: z.string().uuid() }).parse(request.params);
    const body = reportAiUsageSchema.parse(request.body);

    const existing = await getTask(app.database, params.taskId);
    const { project } = await requireProjectContext(app.database, existing.projectId);
    requireWorkspaceMaintainer(principal, project.workspaceId);
    assertProjectNotArchived(project);

    const task = await updateTask(app.database, params.taskId, {
      tokensUsed: body.tokensUsed,
      aiSystemId:
        body.aiSystemId === undefined ? existing.aiSystemId : body.aiSystemId,
      actorUserId: principal.userId,
      workspaceId: project.workspaceId,
    });
    await upsertProjectCostSnapshot(app.database, project.id);

    await writeAuditEvent(app.database, {
      organizationId: await workspaceOrgId(app, project.workspaceId),
      actorType: 'user',
      actorId: principal.userId,
      action: 'project.task_ai_usage_reported',
      entityType: 'project_task',
      entityId: task.id,
      metadata: {
        projectId: project.id,
        tokensUsed: body.tokensUsed,
        aiSystemId: body.aiSystemId ?? null,
      },
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

  app.post(
    '/api/v1/projects/:projectId/timeline/export',
    async (request, reply) => {
      assertMutatingOrigin(app, request);
      const principal = requireAuthenticated(request);
      const params = z
        .object({ projectId: z.string().uuid() })
        .parse(request.params);
      const body = z
        .object({
          title: z.string().min(1).max(300).optional(),
          includeEpics: z.boolean().optional(),
          includeStories: z.boolean().optional(),
          includeMilestones: z.boolean().optional(),
          includeTasks: z.boolean().optional(),
          colorByStatus: z.boolean().optional(),
          showDueDates: z.boolean().optional(),
          showIssueIds: z.boolean().optional(),
          showGrid: z.boolean().optional(),
          today: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .optional(),
          windowFrom: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .nullable()
            .optional(),
          windowTo: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .nullable()
            .optional(),
          tagOffsets: z
            .record(
              z.string().min(1).max(120),
              z.object({
                dx: z.number().finite(),
                dy: z.number().finite(),
              }),
            )
            .optional(),
          labels: z
            .object({
              epic: z.string().min(1).max(80),
              story: z.string().min(1).max(80),
              milestone: z.string().min(1).max(80),
              task: z.string().min(1).max(80),
              generated: z.string().min(1).max(80),
              empty: z.string().min(1).max(200),
              today: z.string().min(1).max(80).optional(),
              scheduleOnTrack: z.string().min(1).max(80).optional(),
              scheduleAtRisk: z.string().min(1).max(80).optional(),
              scheduleOverdue: z.string().min(1).max(80).optional(),
              scheduleCompleted: z.string().min(1).max(80).optional(),
              scheduleNeutral: z.string().min(1).max(80).optional(),
            })
            .optional(),
        })
        .parse(request.body ?? {});

      const { project } = await requireProjectContext(
        app.database,
        params.projectId,
      );
      requireWorkspaceView(principal, project.workspaceId);

      const filters = {
        includeEpics: body.includeEpics ?? true,
        includeStories: body.includeStories ?? true,
        includeMilestones: body.includeMilestones ?? true,
        includeTasks: body.includeTasks ?? true,
      };
      if (
        !filters.includeEpics &&
        !filters.includeStories &&
        !filters.includeMilestones &&
        !filters.includeTasks
      ) {
        throw new AppError({
          code: 'TIMELINE_EXPORT_EMPTY',
          message: 'Select at least one timeline item type to export',
          statusCode: 400,
        });
      }

      const [epics, stories, milestones, tasks] = await Promise.all([
        listEpics(app.database, project.id),
        listUserStories(app.database, project.id),
        listMilestones(app.database, project.id),
        listTasks(app.database, project.id),
      ]);

      const title = body.title?.trim() || `${project.name} timeline`;
      const labels = body.labels ?? {
        epic: 'Epic',
        story: 'Story',
        milestone: 'Milestone',
        task: 'Task',
        generated: 'Generated',
        empty: 'No dated items match the selected filters.',
      };

      let pdf: Buffer;
      try {
        pdf = await buildTimelinePdf({
          title,
          projectName: project.name,
          projectStartDate: project.startDate,
          projectEndDate: project.endDate,
          epics,
          stories,
          milestones,
          tasks,
          filters,
          colorByStatus: body.colorByStatus ?? false,
          showDueDates: body.showDueDates ?? false,
          showIssueIds: body.showIssueIds ?? true,
          showGrid: body.showGrid ?? true,
          today: body.today,
          windowFrom: body.windowFrom ?? null,
          windowTo: body.windowTo ?? null,
          tagOffsets: body.tagOffsets ?? null,
          labels,
        });
      } catch (error) {
        throw new AppError({
          code: 'TIMELINE_EXPORT_FAILED',
          message:
            error instanceof Error
              ? error.message
              : 'Failed to export timeline PDF',
          statusCode: 500,
        });
      }

      await writeAuditEvent(app.database, {
        organizationId: await workspaceOrgId(app, project.workspaceId),
        actorType: 'user',
        actorId: principal.userId,
        action: 'project.timeline_exported',
        entityType: 'project',
        entityId: project.id,
        metadata: {
          format: 'pdf',
          title,
          ...filters,
          colorByStatus: body.colorByStatus ?? false,
          showDueDates: body.showDueDates ?? false,
          showIssueIds: body.showIssueIds ?? true,
          showGrid: body.showGrid ?? true,
        },
        ipAddress: request.ip,
      });

      const filename = knowledgeExportFilename(
        `${project.slug}-timeline`,
        'pdf',
      );
      reply
        .header('Content-Type', 'application/pdf')
        .header(
          'Content-Disposition',
          `attachment; filename="${filename.replace(/"/g, '')}"`,
        );
      return reply.send(pdf);
    },
  );

  app.post(
    '/api/v1/projects/:projectId/board/export',
    async (request, reply) => {
      assertMutatingOrigin(app, request);
      const principal = requireAuthenticated(request);
      const params = z
        .object({ projectId: z.string().uuid() })
        .parse(request.params);
      const body = z
        .object({
          title: z.string().min(1).max(300).optional(),
          showIssueId: z.boolean().optional(),
          showStory: z.boolean().optional(),
          showMilestone: z.boolean().optional(),
          showOwner: z.boolean().optional(),
          showAccountable: z.boolean().optional(),
          showDueDate: z.boolean().optional(),
          showStoryPoints: z.boolean().optional(),
          labels: z
            .object({
              story: z.string().min(1).max(80),
              milestone: z.string().min(1).max(80),
              owner: z.string().min(1).max(80),
              accountable: z.string().min(1).max(80),
              dueDate: z.string().min(1).max(80),
              storyPoints: z.string().min(1).max(80),
              generated: z.string().min(1).max(80),
              empty: z.string().min(1).max(200),
              status: z.record(z.string(), z.string().min(1).max(80)),
              milestoneStatus: z.record(z.string(), z.string().min(1).max(80)),
            })
            .optional(),
        })
        .parse(request.body ?? {});

      const { project } = await requireProjectContext(
        app.database,
        params.projectId,
      );
      requireWorkspaceView(principal, project.workspaceId);

      const meta = {
        showIssueId: body.showIssueId ?? true,
        showStory: body.showStory ?? true,
        showMilestone: body.showMilestone ?? true,
        showOwner: body.showOwner ?? true,
        showAccountable: body.showAccountable ?? true,
        showDueDate: body.showDueDate ?? true,
        showStoryPoints: body.showStoryPoints ?? false,
      };

      const [milestones, tasks] = await Promise.all([
        listMilestones(app.database, project.id),
        listTasks(app.database, project.id),
      ]);
      const milestoneTitleById = new Map(
        milestones.map((row) => [row.id, row.title]),
      );

      const title = body.title?.trim() || `${project.name} board`;
      const labels = body.labels ?? {
        story: 'Story',
        milestone: 'Milestone',
        owner: 'Current owner',
        accountable: 'Accountable (A)',
        dueDate: 'Due date',
        storyPoints: 'Story points',
        generated: 'Generated',
        empty: 'No tasks',
        status: {
          todo: 'To do',
          in_progress: 'In progress',
          blocked: 'Blocked',
          done: 'Done',
          cancelled: 'Cancelled',
        },
        milestoneStatus: {},
      };

      let pdf: Buffer;
      try {
        pdf = await buildBoardPdf({
          title,
          projectName: project.name,
          milestones: milestones.map((row) => ({
            id: row.id,
            title: row.title,
            status: row.status,
            targetDate: row.targetDate,
            humanKey: row.humanKey ?? null,
          })),
          tasks: tasks.map((task) => ({
            id: task.id,
            title: task.title,
            status: task.status,
            dueDate: task.dueDate,
            storyPoints: task.storyPoints ?? null,
            humanKey: task.humanKey ?? null,
            userStoryTitle: task.userStoryTitle ?? null,
            milestoneTitle: task.milestoneId
              ? (milestoneTitleById.get(task.milestoneId) ?? null)
              : null,
            currentOwnerName:
              task.currentOwner?.displayName ??
              task.raci.find((entry) => entry.role === 'R')?.displayName ??
              null,
            accountableName:
              task.raci.find((entry) => entry.role === 'A')?.displayName ?? null,
          })),
          meta,
          labels,
        });
      } catch (error) {
        throw new AppError({
          code: 'BOARD_EXPORT_FAILED',
          message:
            error instanceof Error
              ? error.message
              : 'Failed to export board PDF',
          statusCode: 500,
        });
      }

      await writeAuditEvent(app.database, {
        organizationId: await workspaceOrgId(app, project.workspaceId),
        actorType: 'user',
        actorId: principal.userId,
        action: 'project.board_exported',
        entityType: 'project',
        entityId: project.id,
        metadata: { format: 'pdf', title, ...meta },
        ipAddress: request.ip,
      });

      const filename = knowledgeExportFilename(`${project.slug}-board`, 'pdf');
      reply
        .header('Content-Type', 'application/pdf')
        .header(
          'Content-Disposition',
          `attachment; filename="${filename.replace(/"/g, '')}"`,
        );
      return reply.send(pdf);
    },
  );

  app.post(
    '/api/v1/projects/:projectId/calendar/export',
    async (request, reply) => {
      assertMutatingOrigin(app, request);
      const principal = requireAuthenticated(request);
      const params = z
        .object({ projectId: z.string().uuid() })
        .parse(request.params);
      const body = z
        .object({
          title: z.string().min(1).max(300).optional(),
          year: z.number().int().min(1970).max(2100),
          monthIndex: z.number().int().min(0).max(11),
          today: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .optional(),
          labels: z
            .object({
              generated: z.string().min(1).max(80),
              empty: z.string().min(1).max(200),
              more: z.string().min(1).max(80),
              milestone: z.string().min(1).max(80),
              task: z.string().min(1).max(80),
              weekdays: z.object({
                mon: z.string().min(1).max(40),
                tue: z.string().min(1).max(40),
                wed: z.string().min(1).max(40),
                thu: z.string().min(1).max(40),
                fri: z.string().min(1).max(40),
                sat: z.string().min(1).max(40),
                sun: z.string().min(1).max(40),
              }),
              monthLabel: z.string().min(1).max(120),
            })
            .optional(),
        })
        .parse(request.body ?? {});

      const { project } = await requireProjectContext(
        app.database,
        params.projectId,
      );
      requireWorkspaceView(principal, project.workspaceId);

      const [milestones, tasks] = await Promise.all([
        listMilestones(app.database, project.id),
        listTasks(app.database, project.id),
      ]);

      const today =
        body.today ??
        (() => {
          const now = new Date();
          return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
        })();

      const items = [
        ...milestones
          .filter((row) => row.targetDate)
          .map((row) => ({
            id: `milestone:${row.id}`,
            kind: 'milestone' as const,
            title: row.title,
            date: row.targetDate!,
            status: row.status,
            humanKey: row.humanKey ?? null,
          })),
        ...tasks
          .filter((row) => row.dueDate)
          .map((row) => ({
            id: `task:${row.id}`,
            kind: 'task' as const,
            title: row.title,
            date: row.dueDate!,
            status: row.status,
            humanKey: row.humanKey ?? null,
            ownerName:
              row.currentOwner?.displayName ??
              row.raci.find((entry) => entry.role === 'R')?.displayName ??
              null,
          })),
      ];

      const title = body.title?.trim() || `${project.name} calendar`;
      const labels = body.labels ?? {
        generated: 'Generated',
        empty: 'No dated tasks or milestones this month.',
        more: '+{count} more',
        milestone: 'Milestone',
        task: 'Task',
        weekdays: {
          mon: 'Mon',
          tue: 'Tue',
          wed: 'Wed',
          thu: 'Thu',
          fri: 'Fri',
          sat: 'Sat',
          sun: 'Sun',
        },
        monthLabel: `${body.year}-${body.monthIndex + 1}`,
      };

      let pdf: Buffer;
      try {
        pdf = await buildCalendarPdf({
          title,
          projectName: project.name,
          year: body.year,
          monthIndex: body.monthIndex,
          today,
          items,
          labels,
        });
      } catch (error) {
        throw new AppError({
          code: 'CALENDAR_EXPORT_FAILED',
          message:
            error instanceof Error
              ? error.message
              : 'Failed to export calendar PDF',
          statusCode: 500,
        });
      }

      await writeAuditEvent(app.database, {
        organizationId: await workspaceOrgId(app, project.workspaceId),
        actorType: 'user',
        actorId: principal.userId,
        action: 'project.calendar_exported',
        entityType: 'project',
        entityId: project.id,
        metadata: {
          format: 'pdf',
          title,
          year: body.year,
          monthIndex: body.monthIndex,
        },
        ipAddress: request.ip,
      });

      const filename = knowledgeExportFilename(
        `${project.slug}-calendar`,
        'pdf',
      );
      reply
        .header('Content-Type', 'application/pdf')
        .header(
          'Content-Disposition',
          `attachment; filename="${filename.replace(/"/g, '')}"`,
        );
      return reply.send(pdf);
    },
  );
}
