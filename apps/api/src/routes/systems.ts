import type { FastifyInstance } from 'fastify';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { systems, workspaces } from '@project-knowledge-hub/database';
import {
  aiCostModeSchema,
  systemCriticalitySchema,
  systemItCostModeSchema,
  systemItDetailsSchema,
  systemStatusSchema,
} from '@project-knowledge-hub/domain';
import {
  requireWorkspaceAdmin,
  requireWorkspaceMaintainer,
  requireWorkspaceView,
} from '@project-knowledge-hub/permissions';
import {
  assertMutatingOrigin,
  requireAuthenticated,
} from '../plugins/auth.js';
import { writeAuditEvent } from '../lib/identity.js';
import { getSystemTags } from '../lib/tags.js';
import {
  createSystem,
  getSystemRow,
  toPublicSystem,
  updateSystem,
} from '../lib/systems.js';

const moneySchema = z.union([z.number(), z.string()]).nullable();

const createSystemSchema = z.object({
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid().nullable().optional(),
  name: z.string().min(1).max(160),
  slug: z.string().min(1).max(64).optional(),
  summary: z.string().max(500).optional(),
  description: z.string().max(10000).optional(),
  systemType: z.string().max(120).optional(),
  status: systemStatusSchema.optional(),
  ownerUserId: z.string().uuid().nullable().optional(),
  environment: z.string().max(80).optional(),
  version: z.string().max(80).optional(),
  criticality: systemCriticalitySchema.nullable().optional(),
  itDetails: systemItDetailsSchema.optional(),
  itCostMode: systemItCostModeSchema.nullable().optional(),
  itFlatMonthlyFee: moneySchema.optional(),
  itOneTimeCost: moneySchema.optional(),
  itBudgetAllocation: moneySchema.optional(),
  tags: z.array(z.string().min(1).max(64)).max(30).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const updateSystemSchema = z.object({
  projectId: z.string().uuid().nullable().optional(),
  name: z.string().min(1).max(160).optional(),
  summary: z.string().max(500).nullable().optional(),
  description: z.string().max(10000).nullable().optional(),
  systemType: z.string().max(120).nullable().optional(),
  status: systemStatusSchema.optional(),
  ownerUserId: z.string().uuid().nullable().optional(),
  environment: z.string().max(80).nullable().optional(),
  version: z.string().max(80).nullable().optional(),
  criticality: systemCriticalitySchema.nullable().optional(),
  itDetails: systemItDetailsSchema.nullable().optional(),
  itCostMode: systemItCostModeSchema.nullable().optional(),
  itFlatMonthlyFee: moneySchema.optional(),
  itOneTimeCost: moneySchema.optional(),
  itBudgetAllocation: moneySchema.optional(),
  tags: z.array(z.string().min(1).max(64)).max(30).optional(),
  metadata: z.record(z.unknown()).nullable().optional(),
  archived: z.boolean().optional(),
  aiCostMode: aiCostModeSchema.nullable().optional(),
  aiFlatMonthlyFee: moneySchema.optional(),
  aiTokenRatePer1k: moneySchema.optional(),
  aiBudgetAllocation: moneySchema.optional(),
});

export async function registerSystemRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/systems', async (request) => {
    const principal = requireAuthenticated(request);
    const query = z
      .object({
        workspaceId: z.string().uuid(),
        projectId: z.string().uuid().optional(),
        includeArchived: z
          .enum(['true', 'false'])
          .optional()
          .transform((value) => value === 'true'),
      })
      .parse(request.query);

    requireWorkspaceView(principal, query.workspaceId);

    const filters = [eq(systems.workspaceId, query.workspaceId)];
    if (!query.includeArchived) {
      filters.push(isNull(systems.archivedAt));
    }
    if (query.projectId) {
      filters.push(eq(systems.projectId, query.projectId));
    }

    const rows = await app.database.db
      .select()
      .from(systems)
      .where(and(...filters));

    const tagMap = await getSystemTags(
      app.database,
      rows.map((row) => row.id),
    );

    return {
      systems: rows.map((row) => toPublicSystem(row, tagMap.get(row.id) ?? [])),
    };
  });

  app.post('/api/v1/systems', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    const body = createSystemSchema.parse(request.body);
    requireWorkspaceMaintainer(principal, body.workspaceId);

    const system = await createSystem(app.database, body, {
      defaultOwnerUserId: principal.userId,
    });

    const [workspace] = await app.database.db
      .select({ organizationId: workspaces.organizationId })
      .from(workspaces)
      .where(eq(workspaces.id, body.workspaceId))
      .limit(1);

    await writeAuditEvent(app.database, {
      organizationId: workspace?.organizationId ?? null,
      actorType: 'user',
      actorId: principal.userId,
      action: 'system.create',
      entityType: 'system',
      entityId: system.id,
      metadata: {
        slug: system.slug,
        name: system.name,
        projectId: system.projectId,
      },
      ipAddress: request.ip,
    });

    return { system };
  });

  app.get('/api/v1/systems/:systemId', async (request) => {
    const principal = requireAuthenticated(request);
    const params = z.object({ systemId: z.string().uuid() }).parse(request.params);
    const row = await getSystemRow(app.database, params.systemId, {
      includeArchived: true,
    });
    requireWorkspaceView(principal, row.workspaceId);
    const tagMap = await getSystemTags(app.database, [row.id]);
    return { system: toPublicSystem(row, tagMap.get(row.id) ?? []) };
  });

  app.patch('/api/v1/systems/:systemId', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    const params = z.object({ systemId: z.string().uuid() }).parse(request.params);
    const body = updateSystemSchema.parse(request.body);

    const existing = await getSystemRow(app.database, params.systemId, {
      includeArchived: true,
    });
    requireWorkspaceMaintainer(principal, existing.workspaceId);

    const system = await updateSystem(app.database, params.systemId, body);

    const [workspace] = await app.database.db
      .select({ organizationId: workspaces.organizationId })
      .from(workspaces)
      .where(eq(workspaces.id, existing.workspaceId))
      .limit(1);

    await writeAuditEvent(app.database, {
      organizationId: workspace?.organizationId ?? null,
      actorType: 'user',
      actorId: principal.userId,
      action: 'system.update',
      entityType: 'system',
      entityId: system.id,
      metadata: body,
      ipAddress: request.ip,
    });

    return { system };
  });

  app.delete('/api/v1/systems/:systemId', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    const params = z.object({ systemId: z.string().uuid() }).parse(request.params);

    const system = await getSystemRow(app.database, params.systemId);
    requireWorkspaceMaintainer(principal, system.workspaceId);

    const [archived] = await app.database.db
      .update(systems)
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(eq(systems.id, params.systemId))
      .returning();

    const [workspace] = await app.database.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, system.workspaceId))
      .limit(1);

    await writeAuditEvent(app.database, {
      organizationId: workspace?.organizationId ?? null,
      actorType: 'user',
      actorId: principal.userId,
      action: 'system.archive',
      entityType: 'system',
      entityId: system.id,
      ipAddress: request.ip,
    });

    const tagMap = await getSystemTags(app.database, [system.id]);
    return {
      system: archived
        ? toPublicSystem(archived, tagMap.get(archived.id) ?? [])
        : null,
    };
  });

  /** Permanent delete — linked records/imports keep rows but lose systemId. */
  app.post('/api/v1/systems/:systemId/purge', async (request, reply) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    const params = z.object({ systemId: z.string().uuid() }).parse(request.params);
    z.object({ confirmDestroy: z.literal(true) }).parse(request.body ?? {});

    const system = await getSystemRow(app.database, params.systemId, {
      includeArchived: true,
    });
    requireWorkspaceAdmin(principal, system.workspaceId);

    const [workspace] = await app.database.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, system.workspaceId))
      .limit(1);

    await app.database.db.delete(systems).where(eq(systems.id, system.id));

    await writeAuditEvent(app.database, {
      organizationId: workspace?.organizationId ?? null,
      actorType: 'user',
      actorId: principal.userId,
      action: 'system.purge',
      entityType: 'system',
      entityId: system.id,
      metadata: { name: system.name, slug: system.slug },
      ipAddress: request.ip,
    });

    return reply.status(204).send();
  });
}
