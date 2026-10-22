import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { workspaces } from '@project-knowledge-hub/database';
import {
  MODEL_RATE_IMPORT_MAX_CHARS,
  USAGE_CSV_MAX_CHARS,
  auditModelPriceMetadata,
  modelRatesToCsv,
  modelRatesToJson,
} from '@project-knowledge-hub/domain';
import {
  requireSystemAdmin,
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
import {
  applyScopedModelRateImport,
  deleteAiModelPrice,
  listAiModelPrices,
  listGlobalAiModelPrices,
  loadImportedTheoretical,
  previewScopedModelRateImport,
  retireScopedAiModelPrice,
  upsertScopedAiModelPrice,
} from '../lib/ai-usage-pricing.js';
import { upsertProjectCostSnapshot } from '../lib/project-budget.js';

const csvBody = z.object({
  csv: z.string().min(1).max(USAGE_CSV_MAX_CHARS),
  fileName: z.string().max(200).optional(),
});

const priceBody = z.object({
  model: z.string(),
  inputPerMillion: z.number(),
  cacheWritePerMillion: z.number(),
  cacheReadPerMillion: z.number(),
  outputPerMillion: z.number(),
  blendedPerMillion: z.number().optional(),
  currency: z.string(),
  effectiveFrom: z.string(),
  sourceNote: z.string().nullable().optional(),
});

const importBody = z.object({
  format: z.enum(['csv', 'json']),
  text: z.string().min(1).max(MODEL_RATE_IMPORT_MAX_CHARS),
});

function priceInput(body: z.infer<typeof priceBody>) {
  return {
    ...body,
    blendedPerMillion: body.blendedPerMillion ?? body.inputPerMillion,
    sourceNote: body.sourceNote ?? null,
  };
}

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

  app.get('/api/v1/workspaces/:workspaceId/ai-model-prices', async (request) => {
    const principal = requireAuthenticated(request);
    const params = z.object({ workspaceId: z.string().uuid() }).parse(request.params);
    requireWorkspaceView(principal, params.workspaceId);
    return { prices: await listAiModelPrices(app.database, params.workspaceId) };
  });

  app.put('/api/v1/workspaces/:workspaceId/ai-model-prices', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    const params = z.object({ workspaceId: z.string().uuid() }).parse(request.params);
    const body = priceBody.parse(request.body);
    requireWorkspaceAdmin(principal, params.workspaceId);
    const price = await upsertScopedAiModelPrice(
      app.database,
      params.workspaceId,
      priceInput(body),
    );
    await writeAuditEvent(app.database, {
      organizationId: await workspaceOrganizationId(app.database, params.workspaceId),
      actorType: 'user',
      actorId: principal.userId,
      action: 'ai_model_price.saved',
      entityType: 'ai_model_price',
      entityId: price.id,
      metadata: auditModelPriceMetadata({
        scope: 'workspace',
        workspaceId: params.workspaceId,
        model: price.model,
        effectiveFrom: price.effectiveFrom,
        currency: price.currency,
        sourceNote: price.sourceNote,
        via: 'http',
      }),
      ipAddress: request.ip,
    });
    return { price };
  });

  app.delete(
    '/api/v1/workspaces/:workspaceId/ai-model-prices/:priceId',
    async (request) => {
      assertMutatingOrigin(app, request);
      const principal = requireAuthenticated(request);
      const params = z
        .object({ workspaceId: z.string().uuid(), priceId: z.string().uuid() })
        .parse(request.params);
      requireWorkspaceAdmin(principal, params.workspaceId);
      const price = await deleteAiModelPrice(app.database, params.workspaceId, params.priceId);
      await writeAuditEvent(app.database, {
        organizationId: await workspaceOrganizationId(app.database, params.workspaceId),
        actorType: 'user',
        actorId: principal.userId,
        action: 'ai_model_price.retired',
        entityType: 'ai_model_price',
        entityId: params.priceId,
        metadata: auditModelPriceMetadata({
          scope: 'workspace',
          workspaceId: params.workspaceId,
          model: price.model,
          effectiveFrom: price.effectiveFrom,
          currency: price.currency,
          sourceNote: price.sourceNote,
          via: 'http',
        }),
        ipAddress: request.ip,
      });
      return { ok: true, price };
    },
  );

  app.post('/api/v1/workspaces/:workspaceId/ai-model-prices/reprice', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    const params = z.object({ workspaceId: z.string().uuid() }).parse(request.params);
    requireWorkspaceAdmin(principal, params.workspaceId);
    const priced = await loadImportedTheoretical(app.database, params.workspaceId);
    return { months: priced.months, unpricedModels: priced.unpricedModels };
  });

  app.post(
    '/api/v1/workspaces/:workspaceId/ai-model-prices/import/preview',
    async (request) => {
      assertMutatingOrigin(app, request);
      const principal = requireAuthenticated(request);
      const params = z.object({ workspaceId: z.string().uuid() }).parse(request.params);
      const body = importBody.parse(request.body);
      requireWorkspaceAdmin(principal, params.workspaceId);
      const plan = await previewScopedModelRateImport(
        app.database,
        params.workspaceId,
        body.text,
        body.format,
      );
      return { plan };
    },
  );

  app.post('/api/v1/workspaces/:workspaceId/ai-model-prices/import', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    const params = z.object({ workspaceId: z.string().uuid() }).parse(request.params);
    const body = importBody.parse(request.body);
    requireWorkspaceAdmin(principal, params.workspaceId);
    const plan = await applyScopedModelRateImport(
      app.database,
      params.workspaceId,
      body.text,
      body.format,
    );
    await writeAuditEvent(app.database, {
      organizationId: await workspaceOrganizationId(app.database, params.workspaceId),
      actorType: 'user',
      actorId: principal.userId,
      action: 'ai_model_price.imported',
      entityType: 'ai_model_price',
      metadata: auditModelPriceMetadata({
        scope: 'workspace',
        workspaceId: params.workspaceId,
        via: 'http',
        counts: {
          added: plan.added.length,
          changed: plan.changed.length,
          unchanged: plan.unchanged.length,
        },
      }),
      ipAddress: request.ip,
    });
    return { plan };
  });

  app.get('/api/v1/workspaces/:workspaceId/ai-model-prices/export', async (request, reply) => {
    const principal = requireAuthenticated(request);
    const params = z.object({ workspaceId: z.string().uuid() }).parse(request.params);
    const query = z.object({ format: z.enum(['csv', 'json']).default('csv') }).parse(request.query);
    requireWorkspaceView(principal, params.workspaceId);
    const prices = (await listAiModelPrices(app.database, params.workspaceId)).filter(
      (row) => row.workspaceId === params.workspaceId && !row.retired,
    );
    const body = query.format === 'json' ? modelRatesToJson(prices) : modelRatesToCsv(prices);
    const type = query.format === 'json' ? 'application/json' : 'text/csv; charset=utf-8';
    return reply
      .header('Content-Type', type)
      .header('Content-Disposition', `attachment; filename="model-rates.${query.format}"`)
      .send(body);
  });

  app.get('/api/v1/admin/ai-model-prices', async (request) => {
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);
    return { prices: await listGlobalAiModelPrices(app.database) };
  });

  app.put('/api/v1/admin/ai-model-prices', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);
    const body = priceBody.parse(request.body);
    const price = await upsertScopedAiModelPrice(app.database, null, priceInput(body), {
      requireSourceNote: true,
    });
    await writeAuditEvent(app.database, {
      actorType: 'user',
      actorId: principal.userId,
      action: 'ai_model_price.saved',
      entityType: 'ai_model_price',
      entityId: price.id,
      metadata: auditModelPriceMetadata({
        scope: 'global',
        model: price.model,
        effectiveFrom: price.effectiveFrom,
        currency: price.currency,
        sourceNote: price.sourceNote,
        via: 'http',
      }),
      ipAddress: request.ip,
    });
    return { price };
  });

  app.post('/api/v1/admin/ai-model-prices/:priceId/retire', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);
    const params = z.object({ priceId: z.string().uuid() }).parse(request.params);
    const price = await retireScopedAiModelPrice(app.database, null, { priceId: params.priceId });
    await writeAuditEvent(app.database, {
      actorType: 'user',
      actorId: principal.userId,
      action: 'ai_model_price.retired',
      entityType: 'ai_model_price',
      entityId: price.id,
      metadata: auditModelPriceMetadata({
        scope: 'global',
        model: price.model,
        effectiveFrom: price.effectiveFrom,
        currency: price.currency,
        sourceNote: price.sourceNote,
        via: 'http',
      }),
      ipAddress: request.ip,
    });
    return { price };
  });

  app.post('/api/v1/admin/ai-model-prices/import/preview', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);
    const body = importBody.parse(request.body);
    return { plan: await previewScopedModelRateImport(app.database, null, body.text, body.format) };
  });

  app.post('/api/v1/admin/ai-model-prices/import', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);
    const body = importBody.parse(request.body);
    const plan = await applyScopedModelRateImport(app.database, null, body.text, body.format);
    await writeAuditEvent(app.database, {
      actorType: 'user',
      actorId: principal.userId,
      action: 'ai_model_price.imported',
      entityType: 'ai_model_price',
      metadata: auditModelPriceMetadata({
        scope: 'global',
        via: 'http',
        counts: {
          added: plan.added.length,
          changed: plan.changed.length,
          unchanged: plan.unchanged.length,
        },
      }),
      ipAddress: request.ip,
    });
    return { plan };
  });

  app.get('/api/v1/admin/ai-model-prices/export', async (request, reply) => {
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);
    const query = z.object({ format: z.enum(['csv', 'json']).default('csv') }).parse(request.query);
    const prices = (await listGlobalAiModelPrices(app.database)).filter((row) => !row.retired);
    const body = query.format === 'json' ? modelRatesToJson(prices) : modelRatesToCsv(prices);
    const type = query.format === 'json' ? 'application/json' : 'text/csv; charset=utf-8';
    return reply
      .header('Content-Type', type)
      .header('Content-Disposition', `attachment; filename="global-model-rates.${query.format}"`)
      .send(body);
  });
}
