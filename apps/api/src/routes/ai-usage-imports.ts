import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { workspaces } from '@project-knowledge-hub/database';
import { USAGE_CSV_MAX_CHARS } from '@project-knowledge-hub/domain';
import {
  requireWorkspaceAdmin,
  requireWorkspaceView,
} from '@project-knowledge-hub/permissions';
import {
  assertMutatingOrigin,
  requireAuthenticated,
} from '../plugins/auth.js';
import { writeAuditEvent } from '../lib/identity.js';
import {
  importAiUsageCsv,
  listAiUsageImports,
  listUnassignedUsage,
  listUnassignedUsageRows,
  previewAiUsageCsv,
} from '../lib/ai-usage-import.js';
import { upsertProjectCostSnapshot } from '../lib/project-budget.js';

const csvBody = z.object({
  csv: z.string().min(1).max(USAGE_CSV_MAX_CHARS),
  fileName: z.string().max(200).optional(),
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

async function refreshProjects(
  database: FastifyInstance['database'],
  projectIds: string[],
): Promise<void> {
  for (const projectId of projectIds) {
    await upsertProjectCostSnapshot(database, projectId);
  }
}

export async function registerAiUsageImportRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get('/api/v1/workspaces/:workspaceId/ai-usage-imports', async (request) => {
    const principal = requireAuthenticated(request);
    const params = z.object({ workspaceId: z.string().uuid() }).parse(request.params);
    requireWorkspaceView(principal, params.workspaceId);
    return {
      imports: await listAiUsageImports(app.database, params.workspaceId),
    };
  });

  app.get(
    '/api/v1/workspaces/:workspaceId/ai-usage-imports/:importId/unassigned',
    async (request) => {
      const principal = requireAuthenticated(request);
      const params = z
        .object({
          workspaceId: z.string().uuid(),
          importId: z.string().uuid(),
        })
        .parse(request.params);
      const query = z
        .object({
          limit: z.coerce.number().int().min(1).max(100).optional(),
          cursor: z.string().min(1).max(200).optional(),
        })
        .parse(request.query);
      requireWorkspaceView(principal, params.workspaceId);
      return listUnassignedUsageRows(app.database, params.workspaceId, {
        importId: params.importId,
        ...(query.limit ? { limit: query.limit } : {}),
        ...(query.cursor ? { cursor: query.cursor } : {}),
      });
    },
  );

  app.get(
    '/api/v1/workspaces/:workspaceId/ai-usage-events/unassigned',
    async (request) => {
      const principal = requireAuthenticated(request);
      const params = z.object({ workspaceId: z.string().uuid() }).parse(request.params);
      requireWorkspaceView(principal, params.workspaceId);
      return listUnassignedUsage(app.database, params.workspaceId);
    },
  );

  app.post(
    '/api/v1/workspaces/:workspaceId/ai-usage-imports/preview',
    async (request) => {
      assertMutatingOrigin(app, request);
      const principal = requireAuthenticated(request);
      const params = z.object({ workspaceId: z.string().uuid() }).parse(request.params);
      const body = csvBody.parse(request.body);
      requireWorkspaceAdmin(principal, params.workspaceId);
      return previewAiUsageCsv(app.database, params.workspaceId, body);
    },
  );

  app.post('/api/v1/workspaces/:workspaceId/ai-usage-imports', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    const params = z.object({ workspaceId: z.string().uuid() }).parse(request.params);
    const body = csvBody.parse(request.body);
    requireWorkspaceAdmin(principal, params.workspaceId);
    const result = await importAiUsageCsv(app.database, params.workspaceId, {
      csv: body.csv,
      fileName: body.fileName,
      actorUserId: principal.userId,
    });
    await refreshProjects(app.database, result.affectedProjectIds);
    await writeAuditEvent(app.database, {
      organizationId: await workspaceOrganizationId(app.database, params.workspaceId),
      actorType: 'user',
      actorId: principal.userId,
      action: 'ai_usage_import.created',
      entityType: 'ai_usage_import',
      entityId: result.usageImport.id,
      metadata: {
        workspaceId: params.workspaceId,
        source: result.usageImport.source,
        fileName: result.usageImport.fileName,
        rowCountInserted: result.usageImport.rowCountInserted,
        rowCountDuplicate: result.usageImport.rowCountDuplicate,
        rowCountLinked: result.usageImport.rowCountLinked,
      },
      ipAddress: request.ip,
    });
    return { import: result.usageImport };
  });
}
