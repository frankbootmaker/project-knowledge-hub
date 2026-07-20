import type { FastifyInstance } from 'fastify';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { apiClients, organizations } from '@project-knowledge-hub/database';
import { AppError } from '@project-knowledge-hub/domain';
import { DEFAULT_MCP_SCOPES, MCP_SCOPES } from '@project-knowledge-hub/mcp';
import {
  assertMutatingOrigin,
  requireAuthenticated,
} from '../plugins/auth.js';
import { requireSystemAdmin } from '@project-knowledge-hub/permissions';
import { writeAuditEvent } from '../lib/identity.js';
import {
  approveApiClient,
  assertActingUserForOrganization,
  assertWriteClientConfig,
  issueApiClientToken,
  rejectApiClient,
  toPublicApiClient,
} from '../lib/api-clients.js';

const scopeSchema = z.enum(
  MCP_SCOPES as unknown as [typeof MCP_SCOPES[number], ...Array<typeof MCP_SCOPES[number]>],
);

const createSchema = z.object({
  organizationId: z.string().uuid(),
  name: z.string().min(1).max(160),
  description: z.string().max(1000).optional(),
  scopes: z.array(scopeSchema).min(1).max(20).optional(),
  allowedWorkspaceIds: z.array(z.string().uuid()).max(100).optional(),
  allowedProjectIds: z.array(z.string().uuid()).max(200).optional(),
  actingUserId: z.string().uuid().nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(160).optional(),
  description: z.string().max(1000).nullable().optional(),
  scopes: z.array(scopeSchema).min(1).max(20).optional(),
  allowedWorkspaceIds: z.array(z.string().uuid()).max(100).optional(),
  allowedProjectIds: z.array(z.string().uuid()).max(200).optional(),
  actingUserId: z.string().uuid().nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

export async function registerApiClientRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/api-clients', async (request) => {
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);
    const query = z
      .object({ organizationId: z.string().uuid().optional() })
      .parse(request.query);

    const rows = query.organizationId
      ? await app.database.db
          .select()
          .from(apiClients)
          .where(
            and(
              eq(apiClients.organizationId, query.organizationId),
              isNull(apiClients.revokedAt),
            ),
          )
          .orderBy(desc(apiClients.createdAt))
      : await app.database.db
          .select()
          .from(apiClients)
          .where(isNull(apiClients.revokedAt))
          .orderBy(desc(apiClients.createdAt));

    // Include rejected pending requests briefly so admins can see outcomes in-session lists
    // are still filtered by revokedAt only (rejected keeps revokedAt null).
    return { apiClients: rows.map(toPublicApiClient) };
  });

  app.post('/api/v1/api-clients', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);
    const body = createSchema.parse(request.body);

    const [organization] = await app.database.db
      .select()
      .from(organizations)
      .where(eq(organizations.id, body.organizationId))
      .limit(1);
    if (!organization) {
      throw new AppError({
        code: 'ORGANIZATION_NOT_FOUND',
        message: 'Organization not found',
        statusCode: 404,
      });
    }

    const scopes = body.scopes ?? [...DEFAULT_MCP_SCOPES];
    const allowedWorkspaceIds = body.allowedWorkspaceIds ?? [];
    const actingUserId = body.actingUserId ?? null;

    assertWriteClientConfig({ scopes, actingUserId, allowedWorkspaceIds });
    if (actingUserId) {
      await assertActingUserForOrganization(app.database, body.organizationId, actingUserId);
    }

    const issued = issueApiClientToken();
    const [created] = await app.database.db
      .insert(apiClients)
      .values({
        organizationId: body.organizationId,
        name: body.name,
        description: body.description ?? null,
        tokenHash: issued.tokenHash,
        tokenPrefix: issued.tokenPrefix,
        scopes,
        allowedWorkspaceIds,
        allowedProjectIds: body.allowedProjectIds ?? [],
        actingUserId,
        status: 'active',
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      })
      .returning();

    if (!created) {
      throw new AppError({
        code: 'API_CLIENT_CREATE_FAILED',
        message: 'Failed to create API client',
        statusCode: 500,
      });
    }

    await writeAuditEvent(app.database, {
      organizationId: body.organizationId,
      actorType: 'user',
      actorId: principal.userId,
      action: 'api_client.create',
      entityType: 'api_client',
      entityId: created.id,
      metadata: { name: created.name, tokenPrefix: created.tokenPrefix },
      ipAddress: request.ip,
    });

    return {
      apiClient: toPublicApiClient(created),
      token: issued.token,
    };
  });

  app.post('/api/v1/api-clients/:clientId/approve', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);
    const params = z.object({ clientId: z.string().uuid() }).parse(request.params);
    const body = updateSchema.parse(request.body ?? {});

    const { client, token } = await approveApiClient(app.database, {
      clientId: params.clientId,
      approverUserId: principal.userId,
      name: body.name,
      scopes: body.scopes,
      allowedWorkspaceIds: body.allowedWorkspaceIds,
      allowedProjectIds: body.allowedProjectIds,
    });

    await writeAuditEvent(app.database, {
      organizationId: client.organizationId,
      actorType: 'user',
      actorId: principal.userId,
      action: 'api_client.approve',
      entityType: 'api_client',
      entityId: client.id,
      metadata: { name: client.name, by: 'admin' },
      ipAddress: request.ip,
    });

    return { apiClient: toPublicApiClient(client), token };
  });

  app.post('/api/v1/api-clients/:clientId/reject', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);
    const params = z.object({ clientId: z.string().uuid() }).parse(request.params);

    const rejected = await rejectApiClient(app.database, params.clientId);

    await writeAuditEvent(app.database, {
      organizationId: rejected.organizationId,
      actorType: 'user',
      actorId: principal.userId,
      action: 'api_client.reject',
      entityType: 'api_client',
      entityId: rejected.id,
      metadata: { by: 'admin' },
      ipAddress: request.ip,
    });

    return { apiClient: toPublicApiClient(rejected) };
  });

  app.patch('/api/v1/api-clients/:clientId', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);
    const params = z.object({ clientId: z.string().uuid() }).parse(request.params);
    const body = updateSchema.parse(request.body);

    const [existing] = await app.database.db
      .select()
      .from(apiClients)
      .where(eq(apiClients.id, params.clientId))
      .limit(1);
    if (!existing || existing.revokedAt || existing.status === 'pending_approval') {
      throw new AppError({
        code: 'API_CLIENT_NOT_FOUND',
        message: 'API client not found',
        statusCode: 404,
      });
    }

    const scopes = body.scopes ?? existing.scopes;
    const allowedWorkspaceIds = body.allowedWorkspaceIds ?? existing.allowedWorkspaceIds;
    const actingUserId =
      body.actingUserId === undefined ? existing.actingUserId : body.actingUserId;

    assertWriteClientConfig({ scopes, actingUserId, allowedWorkspaceIds });
    if (actingUserId) {
      await assertActingUserForOrganization(
        app.database,
        existing.organizationId,
        actingUserId,
      );
    }

    const [updated] = await app.database.db
      .update(apiClients)
      .set({
        name: body.name ?? existing.name,
        description: body.description === undefined ? existing.description : body.description,
        scopes,
        allowedWorkspaceIds,
        allowedProjectIds: body.allowedProjectIds ?? existing.allowedProjectIds,
        actingUserId,
        expiresAt:
          body.expiresAt === undefined
            ? existing.expiresAt
            : body.expiresAt
              ? new Date(body.expiresAt)
              : null,
      })
      .where(eq(apiClients.id, params.clientId))
      .returning();

    await writeAuditEvent(app.database, {
      organizationId: existing.organizationId,
      actorType: 'user',
      actorId: principal.userId,
      action: 'api_client.update',
      entityType: 'api_client',
      entityId: existing.id,
      metadata: body,
      ipAddress: request.ip,
    });

    return { apiClient: updated ? toPublicApiClient(updated) : null };
  });

  app.post('/api/v1/api-clients/:clientId/rotate', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);
    const params = z.object({ clientId: z.string().uuid() }).parse(request.params);

    const [existing] = await app.database.db
      .select()
      .from(apiClients)
      .where(eq(apiClients.id, params.clientId))
      .limit(1);
    if (
      !existing ||
      existing.revokedAt ||
      existing.status !== 'active' ||
      !existing.tokenHash
    ) {
      throw new AppError({
        code: 'API_CLIENT_NOT_FOUND',
        message: 'API client not found',
        statusCode: 404,
      });
    }

    const issued = issueApiClientToken();
    const [updated] = await app.database.db
      .update(apiClients)
      .set({
        tokenHash: issued.tokenHash,
        tokenPrefix: issued.tokenPrefix,
        unclaimedToken: null,
        tokenClaimedAt: new Date(),
      })
      .where(eq(apiClients.id, params.clientId))
      .returning();

    await writeAuditEvent(app.database, {
      organizationId: existing.organizationId,
      actorType: 'user',
      actorId: principal.userId,
      action: 'api_client.rotate',
      entityType: 'api_client',
      entityId: existing.id,
      ipAddress: request.ip,
    });

    return {
      apiClient: updated ? toPublicApiClient(updated) : null,
      token: issued.token,
    };
  });

  app.delete('/api/v1/api-clients/:clientId', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);
    const params = z.object({ clientId: z.string().uuid() }).parse(request.params);

    const [existing] = await app.database.db
      .select()
      .from(apiClients)
      .where(eq(apiClients.id, params.clientId))
      .limit(1);
    if (!existing || existing.revokedAt) {
      throw new AppError({
        code: 'API_CLIENT_NOT_FOUND',
        message: 'API client not found',
        statusCode: 404,
      });
    }

    const [revoked] = await app.database.db
      .update(apiClients)
      .set({ revokedAt: new Date() })
      .where(eq(apiClients.id, params.clientId))
      .returning();

    await writeAuditEvent(app.database, {
      organizationId: existing.organizationId,
      actorType: 'user',
      actorId: principal.userId,
      action: 'api_client.revoke',
      entityType: 'api_client',
      entityId: existing.id,
      ipAddress: request.ip,
    });

    return { apiClient: revoked ? toPublicApiClient(revoked) : null };
  });
}
