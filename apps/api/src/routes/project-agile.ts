import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { workspaces } from '@project-knowledge-hub/database';
import {
  epicStatusSchema,
  userStoryStatusSchema,
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
  addTaskComment,
  createEpic,
  createUserStory,
  getEpic,
  getUserStory,
  handoffTask,
  listEpics,
  listTaskActivities,
  listUserStories,
  updateEpic,
  updateUserStory,
} from '../lib/project-agile.js';
import {
  assertProjectNotArchived,
  getTask,
  requireProjectContext,
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

const createEpicSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(5000).nullable().optional(),
  status: epicStatusSchema.optional(),
  sortOrder: z.number().int().min(0).max(100000).optional(),
});

const updateEpicSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).nullable().optional(),
  status: epicStatusSchema.optional(),
  sortOrder: z.number().int().min(0).max(100000).optional(),
  archived: z.boolean().optional(),
});

const createStorySchema = z.object({
  epicId: z.string().uuid(),
  title: z.string().min(1).max(200),
  description: z.string().max(5000).nullable().optional(),
  status: userStoryStatusSchema.optional(),
  sortOrder: z.number().int().min(0).max(100000).optional(),
});

const updateStorySchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).nullable().optional(),
  status: userStoryStatusSchema.optional(),
  epicId: z.string().uuid().optional(),
  sortOrder: z.number().int().min(0).max(100000).optional(),
  archived: z.boolean().optional(),
});

const commentSchema = z.object({
  body: z.string().min(1).max(10000),
});

const handoffSchema = z.object({
  toUserId: z.string().uuid(),
  note: z.string().max(5000).nullable().optional(),
});

export async function registerProjectAgileRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get('/api/v1/projects/:projectId/epics', async (request) => {
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
      epics: await listEpics(app.database, project.id, {
        includeArchived: query.includeArchived,
      }),
    };
  });

  app.post('/api/v1/projects/:projectId/epics', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    const params = z.object({ projectId: z.string().uuid() }).parse(request.params);
    const body = createEpicSchema.parse(request.body);

    const { project } = await requireProjectContext(app.database, params.projectId);
    requireWorkspaceMaintainer(principal, project.workspaceId);
    assertProjectNotArchived(project);

    const epic = await createEpic(app.database, {
      projectId: project.id,
      ...body,
    });

    await writeAuditEvent(app.database, {
      organizationId: await workspaceOrgId(app, project.workspaceId),
      actorType: 'user',
      actorId: principal.userId,
      action: 'project.epic_created',
      entityType: 'project_epic',
      entityId: epic.id,
      metadata: { projectId: project.id, title: epic.title },
      ipAddress: request.ip,
    });

    return { epic };
  });

  app.patch('/api/v1/project-epics/:epicId', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    const params = z.object({ epicId: z.string().uuid() }).parse(request.params);
    const body = updateEpicSchema.parse(request.body);

    const existing = await getEpic(app.database, params.epicId);
    const { project } = await requireProjectContext(app.database, existing.projectId);
    requireWorkspaceMaintainer(principal, project.workspaceId);
    assertProjectNotArchived(project);

    const epic = await updateEpic(app.database, params.epicId, body);

    await writeAuditEvent(app.database, {
      organizationId: await workspaceOrgId(app, project.workspaceId),
      actorType: 'user',
      actorId: principal.userId,
      action: 'project.epic_updated',
      entityType: 'project_epic',
      entityId: epic.id,
      metadata: { projectId: project.id, ...body },
      ipAddress: request.ip,
    });

    return { epic };
  });

  app.get('/api/v1/projects/:projectId/user-stories', async (request) => {
    const principal = requireAuthenticated(request);
    const params = z.object({ projectId: z.string().uuid() }).parse(request.params);
    const query = z
      .object({
        epicId: z.string().uuid().optional(),
        includeArchived: z
          .enum(['true', 'false'])
          .optional()
          .transform((value) => value === 'true'),
      })
      .parse(request.query);

    const { project } = await requireProjectContext(app.database, params.projectId);
    requireWorkspaceView(principal, project.workspaceId);

    return {
      userStories: await listUserStories(app.database, project.id, {
        epicId: query.epicId,
        includeArchived: query.includeArchived,
      }),
    };
  });

  app.post('/api/v1/projects/:projectId/user-stories', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    const params = z.object({ projectId: z.string().uuid() }).parse(request.params);
    const body = createStorySchema.parse(request.body);

    const { project } = await requireProjectContext(app.database, params.projectId);
    requireWorkspaceMaintainer(principal, project.workspaceId);
    assertProjectNotArchived(project);

    const userStory = await createUserStory(app.database, {
      projectId: project.id,
      ...body,
    });

    await writeAuditEvent(app.database, {
      organizationId: await workspaceOrgId(app, project.workspaceId),
      actorType: 'user',
      actorId: principal.userId,
      action: 'project.user_story_created',
      entityType: 'project_user_story',
      entityId: userStory.id,
      metadata: { projectId: project.id, title: userStory.title },
      ipAddress: request.ip,
    });

    return { userStory };
  });

  app.patch('/api/v1/project-user-stories/:storyId', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    const params = z.object({ storyId: z.string().uuid() }).parse(request.params);
    const body = updateStorySchema.parse(request.body);

    const existing = await getUserStory(app.database, params.storyId);
    const { project } = await requireProjectContext(app.database, existing.projectId);
    requireWorkspaceMaintainer(principal, project.workspaceId);
    assertProjectNotArchived(project);

    const userStory = await updateUserStory(app.database, params.storyId, body);

    await writeAuditEvent(app.database, {
      organizationId: await workspaceOrgId(app, project.workspaceId),
      actorType: 'user',
      actorId: principal.userId,
      action: 'project.user_story_updated',
      entityType: 'project_user_story',
      entityId: userStory.id,
      metadata: { projectId: project.id, ...body },
      ipAddress: request.ip,
    });

    return { userStory };
  });

  app.get('/api/v1/project-tasks/:taskId/activities', async (request) => {
    const principal = requireAuthenticated(request);
    const params = z.object({ taskId: z.string().uuid() }).parse(request.params);

    const task = await getTask(app.database, params.taskId);
    const { project } = await requireProjectContext(app.database, task.projectId);
    requireWorkspaceView(principal, project.workspaceId);

    return {
      activities: await listTaskActivities(app.database, params.taskId),
    };
  });

  app.post('/api/v1/project-tasks/:taskId/comments', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    const params = z.object({ taskId: z.string().uuid() }).parse(request.params);
    const body = commentSchema.parse(request.body);

    const task = await getTask(app.database, params.taskId);
    const { project } = await requireProjectContext(app.database, task.projectId);
    requireWorkspaceMaintainer(principal, project.workspaceId);
    assertProjectNotArchived(project);

    const activity = await addTaskComment(app.database, {
      taskId: params.taskId,
      actorUserId: principal.userId,
      body: body.body,
    });

    await writeAuditEvent(app.database, {
      organizationId: await workspaceOrgId(app, project.workspaceId),
      actorType: 'user',
      actorId: principal.userId,
      action: 'project.task_commented',
      entityType: 'project_task',
      entityId: task.id,
      metadata: { projectId: project.id },
      ipAddress: request.ip,
    });

    return { activity };
  });

  app.post('/api/v1/project-tasks/:taskId/handoff', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    const params = z.object({ taskId: z.string().uuid() }).parse(request.params);
    const body = handoffSchema.parse(request.body);

    const existing = await getTask(app.database, params.taskId);
    const { project } = await requireProjectContext(app.database, existing.projectId);
    requireWorkspaceMaintainer(principal, project.workspaceId);
    assertProjectNotArchived(project);

    const task = await handoffTask(app.database, {
      taskId: params.taskId,
      workspaceId: project.workspaceId,
      actorUserId: principal.userId,
      toUserId: body.toUserId,
      note: body.note,
    });

    await writeAuditEvent(app.database, {
      organizationId: await workspaceOrgId(app, project.workspaceId),
      actorType: 'user',
      actorId: principal.userId,
      action: 'project.task_handoff',
      entityType: 'project_task',
      entityId: task.id,
      metadata: {
        projectId: project.id,
        toUserId: body.toUserId,
      },
      ipAddress: request.ip,
    });

    return { task };
  });
}
