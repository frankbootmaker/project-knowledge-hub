import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { workspaces } from '@project-knowledge-hub/database';
import { sprintStatusSchema } from '@project-knowledge-hub/domain';
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
  createSprint,
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
