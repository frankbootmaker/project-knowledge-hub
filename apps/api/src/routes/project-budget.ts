import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { projects, workspaces } from '@project-knowledge-hub/database';
import {
  AppError,
  projectCurrencySchema,
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
  getProjectBudgetSummary,
  parseBudgetAmount,
  upsertProjectCostSnapshot,
} from '../lib/project-budget.js';
import {
  assertProjectNotArchived,
  requireProjectContext,
} from '../lib/project-delivery.js';

const moneySchema = z.union([z.number(), z.string()]).nullable();

const patchBudgetSchema = z.object({
  currency: projectCurrencySchema.optional(),
  initialBudget: moneySchema.optional(),
  approvedBudget: moneySchema.optional(),
});

export async function registerProjectBudgetRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get('/api/v1/projects/:projectId/budget-summary', async (request) => {
    const principal = requireAuthenticated(request);
    const params = z.object({ projectId: z.string().uuid() }).parse(request.params);
    const { project } = await requireProjectContext(app.database, params.projectId);
    requireWorkspaceView(principal, project.workspaceId);
    return {
      budget: await getProjectBudgetSummary(app.database, project.id),
    };
  });

  app.patch('/api/v1/projects/:projectId/budget', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    const params = z.object({ projectId: z.string().uuid() }).parse(request.params);
    const body = patchBudgetSchema.parse(request.body);
    const { project } = await requireProjectContext(app.database, params.projectId);
    requireWorkspaceMaintainer(principal, project.workspaceId);
    assertProjectNotArchived(project);

    const nextInitial =
      body.initialBudget === undefined
        ? undefined
        : parseBudgetAmount(body.initialBudget);
    const nextApproved =
      body.approvedBudget === undefined
        ? undefined
        : parseBudgetAmount(body.approvedBudget);

    const [updated] = await app.database.db
      .update(projects)
      .set({
        currency: body.currency ?? project.currency,
        initialBudget:
          nextInitial === undefined ? project.initialBudget : nextInitial,
        approvedBudget:
          nextApproved === undefined ? project.approvedBudget : nextApproved,
        updatedAt: new Date(),
      })
      .where(eq(projects.id, project.id))
      .returning();

    if (!updated) {
      throw new AppError({
        code: 'PROJECT_UPDATE_FAILED',
        message: 'Failed to update project budget',
        statusCode: 500,
      });
    }

    await upsertProjectCostSnapshot(app.database, project.id);

    const [workspace] = await app.database.db
      .select({ organizationId: workspaces.organizationId })
      .from(workspaces)
      .where(eq(workspaces.id, project.workspaceId))
      .limit(1);

    await writeAuditEvent(app.database, {
      organizationId: workspace?.organizationId ?? null,
      actorType: 'user',
      actorId: principal.userId,
      action: 'project.budget_updated',
      entityType: 'project',
      entityId: project.id,
      metadata: body,
      ipAddress: request.ip,
    });

    return {
      budget: await getProjectBudgetSummary(app.database, project.id),
    };
  });
}
