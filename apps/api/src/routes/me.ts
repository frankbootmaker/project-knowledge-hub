import type { FastifyInstance } from 'fastify';
import { and, desc, eq, isNull, ne } from 'drizzle-orm';
import { z } from 'zod';
import {
  hashPassword,
  hashSessionToken,
  verifyPassword,
} from '@project-knowledge-hub/auth';
import { apiClients, sessions, users } from '@project-knowledge-hub/database';
import { AppError, passwordSchema } from '@project-knowledge-hub/domain';
import { DEFAULT_MCP_SCOPES, MCP_SCOPES } from '@project-knowledge-hub/mcp';
import {
  assertMutatingOrigin,
  clearSessionCookie,
  requireAuthenticated,
} from '../plugins/auth.js';
import {
  assertOwnsApiClient,
  mintAiPairingCode,
  PAIRING_CODE_TTL_SECONDS,
  userOwnsClientFilter,
} from '../lib/ai-discover.js';
import {
  approveApiClient,
  rejectApiClient,
  toPublicApiClient,
} from '../lib/api-clients.js';
import { closeUserAccount } from '../lib/close-user.js';
import { getDefaultOrganization, writeAuditEvent } from '../lib/identity.js';
import { toPublicUser } from '../lib/public-user.js';

const updateMeSchema = z.object({
  displayName: z.string().min(1).max(160).optional(),
  fullName: z.string().max(200).nullable().optional(),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});

const closeMeSchema = z.object({
  confirmPhrase: z.literal('CLOSE'),
});

const scopeSchema = z.enum(
  MCP_SCOPES as unknown as [typeof MCP_SCOPES[number], ...Array<typeof MCP_SCOPES[number]>],
);

const approveMeClientSchema = z.object({
  name: z.string().min(1).max(160).optional(),
  scopes: z.array(scopeSchema).min(1).max(20).optional(),
  allowedWorkspaceIds: z.array(z.string().uuid()).max(100).optional(),
  allowedProjectIds: z.array(z.string().uuid()).max(200).optional(),
});

export async function registerMeRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/me', async (request) => {
    const principal = requireAuthenticated(request);
    const [user] = await app.database.db
      .select()
      .from(users)
      .where(eq(users.id, principal.userId))
      .limit(1);
    if (!user) {
      throw new AppError({
        code: 'USER_NOT_FOUND',
        message: 'User not found',
        statusCode: 404,
      });
    }
    return { user: toPublicUser(user) };
  });

  app.patch('/api/v1/me', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    const body = updateMeSchema.parse(request.body);

    if (body.displayName === undefined && body.fullName === undefined) {
      throw new AppError({
        code: 'VALIDATION_ERROR',
        message: 'No profile fields to update',
        statusCode: 400,
      });
    }

    const [existing] = await app.database.db
      .select()
      .from(users)
      .where(eq(users.id, principal.userId))
      .limit(1);
    if (!existing) {
      throw new AppError({
        code: 'USER_NOT_FOUND',
        message: 'User not found',
        statusCode: 404,
      });
    }

    const nextFullName =
      body.fullName === undefined
        ? existing.fullName
        : body.fullName?.trim()
          ? body.fullName.trim()
          : null;

    const [updated] = await app.database.db
      .update(users)
      .set({
        displayName: body.displayName?.trim() ?? existing.displayName,
        fullName: nextFullName,
        updatedAt: new Date(),
      })
      .where(eq(users.id, principal.userId))
      .returning();

    const organization = await getDefaultOrganization(app.database);
    await writeAuditEvent(app.database, {
      organizationId: organization?.id ?? null,
      actorType: 'user',
      actorId: principal.userId,
      action: 'user.profile_update',
      entityType: 'user',
      entityId: principal.userId,
      metadata: { fields: Object.keys(body) },
      ipAddress: request.ip,
    });

    return { user: updated ? toPublicUser(updated) : null };
  });

  app.post('/api/v1/me/password', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    const body = changePasswordSchema.parse(request.body);

    if (body.currentPassword === body.newPassword) {
      throw new AppError({
        code: 'VALIDATION_ERROR',
        message: 'New password must be different from the current password',
        statusCode: 400,
      });
    }

    const [existing] = await app.database.db
      .select()
      .from(users)
      .where(eq(users.id, principal.userId))
      .limit(1);
    if (!existing) {
      throw new AppError({
        code: 'USER_NOT_FOUND',
        message: 'User not found',
        statusCode: 404,
      });
    }
    if (!existing.passwordHash) {
      throw new AppError({
        code: 'PASSWORD_NOT_SET',
        message: 'This account does not use a local password',
        statusCode: 400,
      });
    }

    const valid = await verifyPassword(body.currentPassword, existing.passwordHash);
    if (!valid) {
      throw new AppError({
        code: 'INVALID_PASSWORD',
        message: 'Current password is incorrect',
        statusCode: 400,
      });
    }

    await app.database.db
      .update(users)
      .set({
        passwordHash: await hashPassword(body.newPassword),
        updatedAt: new Date(),
      })
      .where(eq(users.id, principal.userId));

    const rawCookie = request.headers.cookie
      ?.split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${app.env.SESSION_COOKIE_NAME}=`))
      ?.slice(app.env.SESSION_COOKIE_NAME.length + 1);
    const currentToken = rawCookie ? decodeURIComponent(rawCookie) : null;
    if (currentToken) {
      const currentHash = hashSessionToken(currentToken);
      await app.database.db
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(sessions.userId, principal.userId),
            isNull(sessions.revokedAt),
            ne(sessions.tokenHash, currentHash),
          ),
        );
    }

    const organization = await getDefaultOrganization(app.database);
    await writeAuditEvent(app.database, {
      organizationId: organization?.id ?? null,
      actorType: 'user',
      actorId: principal.userId,
      action: 'user.password_change',
      entityType: 'user',
      entityId: principal.userId,
      metadata: {},
      ipAddress: request.ip,
    });

    return { status: 'ok' };
  });

  app.delete('/api/v1/me', async (request, reply) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    closeMeSchema.parse(request.body ?? {});

    const [existing] = await app.database.db
      .select()
      .from(users)
      .where(eq(users.id, principal.userId))
      .limit(1);

    if (!existing) {
      throw new AppError({
        code: 'USER_NOT_FOUND',
        message: 'User not found',
        statusCode: 404,
      });
    }

    const closed = await closeUserAccount(app.database, {
      userId: principal.userId,
      avatarUploadDir: app.env.AVATAR_UPLOAD_DIR,
    });

    const organization = await getDefaultOrganization(app.database);
    await writeAuditEvent(app.database, {
      organizationId: organization?.id ?? null,
      actorType: 'user',
      actorId: principal.userId,
      action: 'user.close_account',
      entityType: 'user',
      entityId: principal.userId,
      metadata: {
        previousEmail: existing.email,
        previousStatus: existing.status,
      },
      ipAddress: request.ip,
    });

    clearSessionCookie(app, reply);
    return { status: 'ok', user: toPublicUser(closed) };
  });

  app.post('/api/v1/me/ai-pairing-codes', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    const minted = await mintAiPairingCode(app.database, principal.userId);
    const discoverUrl = `${app.env.WEB_URL.replace(/\/$/, '')}/ai-discover`;
    const apiDiscoverUrl = `${app.env.API_URL.replace(/\/$/, '')}/api/v1/ai-discover`;

    return {
      code: minted.code,
      expiresAt: minted.expiresAt.toISOString(),
      ttlSeconds: PAIRING_CODE_TTL_SECONDS,
      discoverUrl,
      apiDiscoverUrl,
      defaultScopes: [...DEFAULT_MCP_SCOPES],
    };
  });

  app.get('/api/v1/me/api-clients', async (request) => {
    const principal = requireAuthenticated(request);
    const rows = await app.database.db
      .select()
      .from(apiClients)
      .where(and(userOwnsClientFilter(principal.userId), isNull(apiClients.revokedAt)))
      .orderBy(desc(apiClients.createdAt));

    return { apiClients: rows.map(toPublicApiClient) };
  });

  app.post('/api/v1/me/api-clients/:clientId/approve', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    const params = z.object({ clientId: z.string().uuid() }).parse(request.params);
    const body = approveMeClientSchema.parse(request.body ?? {});

    const [existing] = await app.database.db
      .select()
      .from(apiClients)
      .where(eq(apiClients.id, params.clientId))
      .limit(1);
    if (!existing) {
      throw new AppError({
        code: 'API_CLIENT_NOT_FOUND',
        message: 'API client not found',
        statusCode: 404,
      });
    }
    assertOwnsApiClient(existing, principal.userId);

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
      metadata: { name: client.name, by: 'owner' },
      ipAddress: request.ip,
    });

    return { apiClient: toPublicApiClient(client), token };
  });

  app.post('/api/v1/me/api-clients/:clientId/reject', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    const params = z.object({ clientId: z.string().uuid() }).parse(request.params);

    const [existing] = await app.database.db
      .select()
      .from(apiClients)
      .where(eq(apiClients.id, params.clientId))
      .limit(1);
    if (!existing) {
      throw new AppError({
        code: 'API_CLIENT_NOT_FOUND',
        message: 'API client not found',
        statusCode: 404,
      });
    }
    assertOwnsApiClient(existing, principal.userId);

    const rejected = await rejectApiClient(app.database, params.clientId);

    await writeAuditEvent(app.database, {
      organizationId: rejected.organizationId,
      actorType: 'user',
      actorId: principal.userId,
      action: 'api_client.reject',
      entityType: 'api_client',
      entityId: rejected.id,
      metadata: { by: 'owner' },
      ipAddress: request.ip,
    });

    return { apiClient: toPublicApiClient(rejected) };
  });

  app.delete('/api/v1/me/api-clients/:clientId', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
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
    assertOwnsApiClient(existing, principal.userId);

    if (existing.status === 'pending_approval') {
      const rejected = await rejectApiClient(app.database, params.clientId);
      await writeAuditEvent(app.database, {
        organizationId: rejected.organizationId,
        actorType: 'user',
        actorId: principal.userId,
        action: 'api_client.reject',
        entityType: 'api_client',
        entityId: rejected.id,
        metadata: { by: 'owner', via: 'delete' },
        ipAddress: request.ip,
      });
      return { apiClient: toPublicApiClient(rejected) };
    }

    const [revoked] = await app.database.db
      .update(apiClients)
      .set({
        revokedAt: new Date(),
        unclaimedToken: null,
        claimSecretHash: null,
      })
      .where(eq(apiClients.id, existing.id))
      .returning();

    await writeAuditEvent(app.database, {
      organizationId: existing.organizationId,
      actorType: 'user',
      actorId: principal.userId,
      action: 'api_client.revoke',
      entityType: 'api_client',
      entityId: existing.id,
      metadata: { by: 'owner' },
      ipAddress: request.ip,
    });

    return { apiClient: revoked ? toPublicApiClient(revoked) : null };
  });
}
