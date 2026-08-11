import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { workspaces } from '@project-knowledge-hub/database';
import { AppError, sprintStatusSchema } from '@project-knowledge-hub/domain';
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
  listMilestones,
  listTasks,
  requireProjectContext,
} from '../lib/project-delivery.js';
import { knowledgeExportFilename } from '../lib/knowledge-export.js';
import { buildScrumPdf } from '../lib/scrum-export.js';
import {
  createSprint,
  getPublicSprint,
  getSprint,
  getSprintPointBurndown,
  listSprints,
  updateSprint,
} from '../lib/project-sprints.js';

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

const createSprintSchema = z.object({
  name: z.string().min(1).max(200),
  goal: z.string().max(5000).nullable().optional(),
  status: sprintStatusSchema.optional(),
  startDate: dateStringSchema.optional(),
  endDate: dateStringSchema.optional(),
  capacityPoints: z.number().int().min(0).max(100000).nullable().optional(),
  sortOrder: z.number().int().min(0).max(100000).optional(),
});

const updateSprintSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  goal: z.string().max(5000).nullable().optional(),
  status: sprintStatusSchema.optional(),
  startDate: dateStringSchema.optional(),
  endDate: dateStringSchema.optional(),
  capacityPoints: z.number().int().min(0).max(100000).nullable().optional(),
  sortOrder: z.number().int().min(0).max(100000).optional(),
  archived: z.boolean().optional(),
  unfinishedDestination: z
    .union([
      z.literal('backlog'),
      z.object({ sprintId: z.string().uuid() }),
    ])
    .optional(),
});

export async function registerProjectSprintRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get('/api/v1/projects/:projectId/sprints', async (request) => {
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
      sprints: await listSprints(app.database, project.id, {
        includeArchived: query.includeArchived,
      }),
    };
  });

  app.post('/api/v1/projects/:projectId/sprints', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    const params = z.object({ projectId: z.string().uuid() }).parse(request.params);
    const body = createSprintSchema.parse(request.body);

    const { project } = await requireProjectContext(app.database, params.projectId);
    requireWorkspaceMaintainer(principal, project.workspaceId);
    assertProjectNotArchived(project);

    const sprint = await createSprint(app.database, {
      projectId: project.id,
      ...body,
    });

    await writeAuditEvent(app.database, {
      organizationId: await workspaceOrgId(app, project.workspaceId),
      actorType: 'user',
      actorId: principal.userId,
      action: 'project.sprint_created',
      entityType: 'project_sprint',
      entityId: sprint.id,
      metadata: { projectId: project.id, name: sprint.name },
      ipAddress: request.ip,
    });

    return { sprint };
  });

  app.get('/api/v1/project-sprints/:sprintId/burndown', async (request) => {
    const principal = requireAuthenticated(request);
    const params = z.object({ sprintId: z.string().uuid() }).parse(request.params);
    const existing = await getSprint(app.database, params.sprintId);
    const { project } = await requireProjectContext(app.database, existing.projectId);
    requireWorkspaceView(principal, project.workspaceId);
    return {
      burndown: await getSprintPointBurndown(app.database, params.sprintId),
    };
  });

  app.post(
    '/api/v1/project-sprints/:sprintId/export',
    async (request, reply) => {
      assertMutatingOrigin(app, request);
      const principal = requireAuthenticated(request);
      const params = z
        .object({ sprintId: z.string().uuid() })
        .parse(request.params);
      const body = z
        .object({
          title: z.string().min(1).max(300).optional(),
          includeBurndown: z.boolean().optional(),
          includeBoard: z.boolean().optional(),
          includeBacklog: z.boolean().optional(),
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
              backlog: z.string().min(1).max(80),
              sprintBoard: z.string().min(1).max(80),
              burndown: z.string().min(1).max(80),
              burndownEmpty: z.string().min(1).max(200),
              goal: z.string().min(1).max(80),
              capacity: z.string().min(1).max(80),
              window: z.string().min(1).max(80),
              status: z.record(z.string(), z.string().min(1).max(80)),
              sprintStatus: z.record(z.string(), z.string().min(1).max(80)),
            })
            .optional(),
        })
        .parse(request.body ?? {});

      const sprint = await getPublicSprint(app.database, params.sprintId);
      const { project } = await requireProjectContext(
        app.database,
        sprint.projectId,
      );
      requireWorkspaceView(principal, project.workspaceId);

      const sections = {
        includeBurndown: body.includeBurndown ?? true,
        includeBoard: body.includeBoard ?? true,
        includeBacklog: body.includeBacklog ?? true,
      };
      if (
        !sections.includeBurndown &&
        !sections.includeBoard &&
        !sections.includeBacklog
      ) {
        throw new AppError({
          code: 'SCRUM_EXPORT_EMPTY',
          message: 'Select at least one scrum export section',
          statusCode: 400,
        });
      }

      const meta = {
        showStory: body.showStory ?? true,
        showMilestone: body.showMilestone ?? true,
        showOwner: body.showOwner ?? true,
        showAccountable: body.showAccountable ?? true,
        showDueDate: body.showDueDate ?? true,
        showStoryPoints: body.showStoryPoints ?? true,
      };

      const needsTasks = sections.includeBoard || sections.includeBacklog;
      const [milestones, tasks, burndown] = await Promise.all([
        needsTasks
          ? listMilestones(app.database, project.id)
          : Promise.resolve([]),
        needsTasks ? listTasks(app.database, project.id) : Promise.resolve([]),
        sections.includeBurndown
          ? getSprintPointBurndown(app.database, sprint.id)
          : Promise.resolve(null),
      ]);
      const milestoneTitleById = new Map(
        milestones.map((row) => [row.id, row.title]),
      );

      const mapTask = (task: (typeof tasks)[number]) => ({
        id: task.id,
        title: task.title,
        status: task.status,
        dueDate: task.dueDate,
        storyPoints: task.storyPoints ?? null,
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
      });

      const sprintTasks = sections.includeBoard
        ? tasks.filter((task) => task.sprintId === sprint.id).map(mapTask)
        : [];
      const backlogTasks = sections.includeBacklog
        ? tasks
            .filter((task) => !task.sprintId && task.status !== 'cancelled')
            .map(mapTask)
        : [];

      const title =
        body.title?.trim() ||
        `${project.name} scrum — ${sprint.humanKey ?? sprint.name}`;
      const labels = body.labels ?? {
        story: 'Story',
        milestone: 'Milestone',
        owner: 'Current owner',
        accountable: 'Accountable (A)',
        dueDate: 'Due date',
        storyPoints: 'Story points',
        generated: 'Generated',
        empty: 'No tasks',
        backlog: 'Backlog',
        sprintBoard: 'Sprint board',
        burndown: 'Point burndown',
        burndownEmpty: 'Set sprint dates and story points to see burndown.',
        goal: 'Goal',
        capacity: 'Capacity',
        window: 'Window',
        status: {
          todo: 'To do',
          in_progress: 'In progress',
          blocked: 'Blocked',
          done: 'Done',
          cancelled: 'Cancelled',
        },
        sprintStatus: {
          planned: 'Planned',
          active: 'Active',
          completed: 'Completed',
          cancelled: 'Cancelled',
        },
      };

      let pdf: Buffer;
      try {
        pdf = await buildScrumPdf({
          title,
          projectName: project.name,
          sprint: {
            name: sprint.name,
            humanKey: sprint.humanKey,
            goal: sprint.goal,
            status: sprint.status,
            startDate: sprint.startDate,
            endDate: sprint.endDate,
            capacityPoints: sprint.capacityPoints,
            committedPoints: sprint.committedPoints,
            donePoints: sprint.donePoints,
          },
          sprintTasks,
          backlogTasks,
          burndown: burndown
            ? {
                committedPoints: burndown.committedPoints,
                startDate: burndown.startDate,
                endDate: burndown.endDate,
                points: burndown.points,
              }
            : null,
          sections,
          meta,
          labels,
        });
      } catch (error) {
        throw new AppError({
          code: 'SCRUM_EXPORT_FAILED',
          message:
            error instanceof Error
              ? error.message
              : 'Failed to export scrum PDF',
          statusCode: 500,
        });
      }

      await writeAuditEvent(app.database, {
        organizationId: await workspaceOrgId(app, project.workspaceId),
        actorType: 'user',
        actorId: principal.userId,
        action: 'project.scrum_exported',
        entityType: 'project_sprint',
        entityId: sprint.id,
        metadata: { format: 'pdf', title, projectId: project.id, ...sections, ...meta },
        ipAddress: request.ip,
      });

      const filename = knowledgeExportFilename(
        `${project.slug}-scrum-${sprint.humanKey ?? sprint.name}`,
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

  app.patch('/api/v1/project-sprints/:sprintId', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    const params = z.object({ sprintId: z.string().uuid() }).parse(request.params);
    const body = updateSprintSchema.parse(request.body);

    const existing = await getSprint(app.database, params.sprintId);
    const { project } = await requireProjectContext(app.database, existing.projectId);
    requireWorkspaceMaintainer(principal, project.workspaceId);
    assertProjectNotArchived(project);

    const sprint = await updateSprint(app.database, params.sprintId, body);

    await writeAuditEvent(app.database, {
      organizationId: await workspaceOrgId(app, project.workspaceId),
      actorType: 'user',
      actorId: principal.userId,
      action: 'project.sprint_updated',
      entityType: 'project_sprint',
      entityId: sprint.id,
      metadata: { projectId: project.id, fields: Object.keys(body) },
      ipAddress: request.ip,
    });

    return { sprint };
  });
}
