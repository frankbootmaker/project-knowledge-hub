import type { FastifyInstance } from 'fastify';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { projects, workspaces } from '@project-knowledge-hub/database';
import {
  AI_BILLING_ENTRY_TYPES,
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
  createAiBillingEntry,
  deleteAiBillingEntry,
  getAiBillingEntry,
  listAiBillingEntries,
  loadWorkspaceAiCostOverview,
  setAiBillingAllocation,
  updateAiBillingEntry,
} from '../lib/ai-billing.js';
import { upsertProjectCostSnapshot } from '../lib/project-budget.js';

const entryType = z.enum(AI_BILLING_ENTRY_TYPES);
const money = z.union([z.number(), z.string()]);

const createSchema = z.object({
  aiSystemId: z.string().uuid().nullable().optional(),
  period: z.string(),
  provider: z.string(),
  plan: z.string().nullable().optional(),
  type: entryType,
  amount: money,
  currency: projectCurrencySchema,
  paidAt: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  externalRef: z.string().nullable().optional(),
});

const updateSchema = createSchema.partial();

const allocationSchema = z.object({
  projectId: z.string().uuid(),
  period: z.string(),
  aiSystemId: z.string().uuid().nullable().optional(),
  percent: z.number().nullable(),
});

async function workspaceOrganizationId(
  database: FastifyInstance['database'],
  workspaceId: string,
): Promise<string | null> {
  const [workspace] = await database.db
    .select({ organizationId: workspaces.organizationId })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  return workspace?.organizationId ?? null;
}

async function refreshWorkspaceSnapshots(
  database: FastifyInstance['database'],
  workspaceId: string,
): Promise<void> {
  const rows = await database.db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.workspaceId, workspaceId), isNull(projects.archivedAt)));
  for (const row of rows) {
    await upsertProjectCostSnapshot(database, row.id);
  }
}

export async function registerAiBillingRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get(
    '/api/v1/workspaces/:workspaceId/ai-cost',
    async (request) => {
      const principal = requireAuthenticated(request);
      const params = z
        .object({ workspaceId: z.string().uuid() })
        .parse(request.params);
      requireWorkspaceView(principal, params.workspaceId);
      return loadWorkspaceAiCostOverview(app.database, params.workspaceId);
    },
  );

  app.get(
    '/api/v1/workspaces/:workspaceId/ai-billing-entries',
    async (request) => {
      const principal = requireAuthenticated(request);
      const params = z
        .object({ workspaceId: z.string().uuid() })
        .parse(request.params);
      const query = z
        .object({
          period: z.string().optional(),
          aiSystemId: z.string().uuid().optional(),
        })
        .parse(request.query);
      requireWorkspaceView(principal, params.workspaceId);
      return {
        entries: await listAiBillingEntries(app.database, params.workspaceId, query),
      };
    },
  );

  app.post(
    '/api/v1/workspaces/:workspaceId/ai-billing-entries',
    async (request) => {
      assertMutatingOrigin(app, request);
      const principal = requireAuthenticated(request);
      const params = z
        .object({ workspaceId: z.string().uuid() })
        .parse(request.params);
      const body = createSchema.parse(request.body);
      requireWorkspaceMaintainer(principal, params.workspaceId);
      const entry = await createAiBillingEntry(
        app.database,
        params.workspaceId,
        body,
        principal.userId,
      );
      await refreshWorkspaceSnapshots(app.database, params.workspaceId);
      await writeAuditEvent(app.database, {
        organizationId: await workspaceOrganizationId(
          app.database,
          params.workspaceId,
        ),
        actorType: 'user',
        actorId: principal.userId,
        action: 'ai_billing_entry.created',
        entityType: 'ai_billing_entry',
        entityId: entry.id,
        metadata: { workspaceId: params.workspaceId, period: entry.period },
      });
      return { entry };
    },
  );

  app.patch(
    '/api/v1/workspaces/:workspaceId/ai-billing-entries/:entryId',
    async (request) => {
      assertMutatingOrigin(app, request);
      const principal = requireAuthenticated(request);
      const params = z
        .object({
          workspaceId: z.string().uuid(),
          entryId: z.string().uuid(),
        })
        .parse(request.params);
      const body = updateSchema.parse(request.body);
      requireWorkspaceMaintainer(principal, params.workspaceId);
      const existing = await getAiBillingEntry(app.database, params.entryId);
      if (!existing || existing.workspaceId !== params.workspaceId) {
        throw new AppError({
          code: 'BILLING_ENTRY_NOT_FOUND',
          message: 'Billing entry not found',
          statusCode: 404,
        });
      }
      const entry = await updateAiBillingEntry(app.database, params.entryId, body);
      await refreshWorkspaceSnapshots(app.database, params.workspaceId);
      await writeAuditEvent(app.database, {
        organizationId: await workspaceOrganizationId(
          app.database,
          params.workspaceId,
        ),
        actorType: 'user',
        actorId: principal.userId,
        action: 'ai_billing_entry.updated',
        entityType: 'ai_billing_entry',
        entityId: entry.id,
        metadata: { workspaceId: params.workspaceId },
      });
      return { entry };
    },
  );

  app.delete(
    '/api/v1/workspaces/:workspaceId/ai-billing-entries/:entryId',
    async (request) => {
      assertMutatingOrigin(app, request);
      const principal = requireAuthenticated(request);
      const params = z
        .object({
          workspaceId: z.string().uuid(),
          entryId: z.string().uuid(),
        })
        .parse(request.params);
      requireWorkspaceMaintainer(principal, params.workspaceId);
      const existing = await getAiBillingEntry(app.database, params.entryId);
      if (!existing || existing.workspaceId !== params.workspaceId) {
        throw new AppError({
          code: 'BILLING_ENTRY_NOT_FOUND',
          message: 'Billing entry not found',
          statusCode: 404,
        });
      }
      await deleteAiBillingEntry(app.database, params.entryId);
      await refreshWorkspaceSnapshots(app.database, params.workspaceId);
      await writeAuditEvent(app.database, {
        organizationId: await workspaceOrganizationId(
          app.database,
          params.workspaceId,
        ),
        actorType: 'user',
        actorId: principal.userId,
        action: 'ai_billing_entry.deleted',
        entityType: 'ai_billing_entry',
        entityId: params.entryId,
        metadata: { workspaceId: params.workspaceId },
      });
      return { deleted: true };
    },
  );

  app.put(
    '/api/v1/workspaces/:workspaceId/ai-billing-allocations',
    async (request) => {
      assertMutatingOrigin(app, request);
      const principal = requireAuthenticated(request);
      const params = z
        .object({ workspaceId: z.string().uuid() })
        .parse(request.params);
      const body = allocationSchema.parse(request.body);
      requireWorkspaceMaintainer(principal, params.workspaceId);
      await setAiBillingAllocation(app.database, {
        workspaceId: params.workspaceId,
        projectId: body.projectId,
        period: body.period,
        aiSystemId: body.aiSystemId ?? null,
        percent: body.percent,
      });
      await refreshWorkspaceSnapshots(app.database, params.workspaceId);
      return { ok: true };
    },
  );
}
