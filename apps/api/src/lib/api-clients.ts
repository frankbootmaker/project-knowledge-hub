import { and, eq, isNull, or, gt } from 'drizzle-orm';
import { createSessionToken, hashSessionToken } from '@project-knowledge-hub/auth';
import {
  apiClients,
  memberships,
  users,
  workspaces,
  type Database,
} from '@project-knowledge-hub/database';
import { AppError } from '@project-knowledge-hub/domain';
import { DEFAULT_MCP_SCOPES, type McpClientContext } from '@project-knowledge-hub/mcp';

export const API_CLIENT_STATUSES = [
  'pending_approval',
  'active',
  'rejected',
] as const;

export type ApiClientStatus = (typeof API_CLIENT_STATUSES)[number];

export function toPublicApiClient(client: typeof apiClients.$inferSelect) {
  return {
    id: client.id,
    organizationId: client.organizationId,
    name: client.name,
    description: client.description,
    tokenPrefix: client.tokenPrefix,
    scopes: client.scopes,
    allowedWorkspaceIds: client.allowedWorkspaceIds,
    allowedProjectIds: client.allowedProjectIds,
    actingUserId: client.actingUserId,
    status: client.status,
    requestedByUserId: client.requestedByUserId,
    approvedByUserId: client.approvedByUserId,
    approvedAt: client.approvedAt?.toISOString() ?? null,
    agentLabel: client.agentLabel,
    tokenClaimedAt: client.tokenClaimedAt?.toISOString() ?? null,
    expiresAt: client.expiresAt?.toISOString() ?? null,
    lastUsedAt: client.lastUsedAt?.toISOString() ?? null,
    revokedAt: client.revokedAt?.toISOString() ?? null,
    createdAt: client.createdAt.toISOString(),
  };
}

export function issueApiClientToken(): { token: string; tokenHash: string; tokenPrefix: string } {
  const token = `kh_${createSessionToken()}`;
  return {
    token,
    tokenHash: hashSessionToken(token),
    tokenPrefix: token.slice(0, 12),
  };
}

export async function assertActingUserForOrganization(
  database: Database,
  organizationId: string,
  actingUserId: string,
): Promise<void> {
  const [user] = await database.db
    .select()
    .from(users)
    .where(eq(users.id, actingUserId))
    .limit(1);

  if (!user || user.status !== 'active') {
    throw new AppError({
      code: 'ACTING_USER_NOT_FOUND',
      message: 'Acting user not found or inactive',
      statusCode: 400,
    });
  }

  if (user.isSystemAdmin) {
    return;
  }

  const [membership] = await database.db
    .select({ id: memberships.id })
    .from(memberships)
    .innerJoin(workspaces, eq(memberships.workspaceId, workspaces.id))
    .where(
      and(
        eq(memberships.userId, actingUserId),
        eq(workspaces.organizationId, organizationId),
        isNull(workspaces.archivedAt),
      ),
    )
    .limit(1);

  if (!membership) {
    throw new AppError({
      code: 'ACTING_USER_NOT_IN_ORGANIZATION',
      message: 'Acting user must be a system admin or a member of a workspace in the organization',
      statusCode: 400,
    });
  }
}

export function assertWriteClientConfig(input: {
  scopes: string[];
  actingUserId: string | null | undefined;
  allowedWorkspaceIds: string[];
}): void {
  if (!input.scopes.includes('knowledge:write')) {
    return;
  }
  if (!input.actingUserId) {
    throw new AppError({
      code: 'ACTING_USER_REQUIRED',
      message: 'actingUserId is required when scopes include knowledge:write',
      statusCode: 400,
    });
  }
  if (input.allowedWorkspaceIds.length === 0) {
    throw new AppError({
      code: 'WORKSPACE_ALLOWLIST_REQUIRED',
      message: 'allowedWorkspaceIds must be non-empty when scopes include knowledge:write',
      statusCode: 400,
    });
  }
}

export async function approveApiClient(
  database: Database,
  input: {
    clientId: string;
    approverUserId: string;
    scopes?: string[];
    allowedWorkspaceIds?: string[];
    allowedProjectIds?: string[];
    name?: string;
  },
): Promise<{ client: typeof apiClients.$inferSelect; token: string }> {
  const [existing] = await database.db
    .select()
    .from(apiClients)
    .where(eq(apiClients.id, input.clientId))
    .limit(1);

  if (!existing || existing.revokedAt) {
    throw new AppError({
      code: 'API_CLIENT_NOT_FOUND',
      message: 'API client not found',
      statusCode: 404,
    });
  }

  if (existing.status !== 'pending_approval') {
    throw new AppError({
      code: 'API_CLIENT_NOT_PENDING',
      message: 'Only pending API client requests can be approved',
      statusCode: 400,
    });
  }

  const scopes = input.scopes ?? existing.scopes;
  const allowedWorkspaceIds = input.allowedWorkspaceIds ?? existing.allowedWorkspaceIds;
  const allowedProjectIds = input.allowedProjectIds ?? existing.allowedProjectIds;
  const actingUserId = existing.actingUserId ?? existing.requestedByUserId;

  assertWriteClientConfig({ scopes, actingUserId, allowedWorkspaceIds });
  if (actingUserId) {
    await assertActingUserForOrganization(
      database,
      existing.organizationId,
      actingUserId,
    );
  }

  const issued = issueApiClientToken();
  const now = new Date();
  const [updated] = await database.db
    .update(apiClients)
    .set({
      name: input.name?.trim() || existing.name,
      scopes,
      allowedWorkspaceIds,
      allowedProjectIds,
      actingUserId,
      status: 'active',
      approvedByUserId: input.approverUserId,
      approvedAt: now,
      tokenHash: issued.tokenHash,
      tokenPrefix: issued.tokenPrefix,
      unclaimedToken: issued.token,
      tokenClaimedAt: null,
    })
    .where(eq(apiClients.id, existing.id))
    .returning();

  if (!updated) {
    throw new AppError({
      code: 'API_CLIENT_NOT_FOUND',
      message: 'API client not found',
      statusCode: 404,
    });
  }

  return { client: updated, token: issued.token };
}

export async function rejectApiClient(
  database: Database,
  clientId: string,
): Promise<typeof apiClients.$inferSelect> {
  const [existing] = await database.db
    .select()
    .from(apiClients)
    .where(eq(apiClients.id, clientId))
    .limit(1);

  if (!existing || existing.revokedAt) {
    throw new AppError({
      code: 'API_CLIENT_NOT_FOUND',
      message: 'API client not found',
      statusCode: 404,
    });
  }

  if (existing.status !== 'pending_approval') {
    throw new AppError({
      code: 'API_CLIENT_NOT_PENDING',
      message: 'Only pending API client requests can be rejected',
      statusCode: 400,
    });
  }

  const [updated] = await database.db
    .update(apiClients)
    .set({
      status: 'rejected',
      claimSecretHash: null,
      unclaimedToken: null,
    })
    .where(eq(apiClients.id, existing.id))
    .returning();

  if (!updated) {
    throw new AppError({
      code: 'API_CLIENT_NOT_FOUND',
      message: 'API client not found',
      statusCode: 404,
    });
  }

  return updated;
}

export async function loadApiClientByBearerToken(
  database: Database,
  token: string,
): Promise<(typeof apiClients.$inferSelect & { context: McpClientContext }) | null> {
  const tokenHash = hashSessionToken(token);
  const now = new Date();
  const [client] = await database.db
    .select()
    .from(apiClients)
    .where(
      and(
        eq(apiClients.tokenHash, tokenHash),
        eq(apiClients.status, 'active'),
        isNull(apiClients.revokedAt),
        or(isNull(apiClients.expiresAt), gt(apiClients.expiresAt, now)),
      ),
    )
    .limit(1);

  if (!client) {
    return null;
  }

  await database.db
    .update(apiClients)
    .set({ lastUsedAt: now })
    .where(eq(apiClients.id, client.id));

  return {
    ...client,
    context: {
      id: client.id,
      name: client.name,
      organizationId: client.organizationId,
      scopes: client.scopes.length > 0 ? client.scopes : [...DEFAULT_MCP_SCOPES],
      allowedWorkspaceIds: client.allowedWorkspaceIds,
      allowedProjectIds: client.allowedProjectIds,
      actingUserId: client.actingUserId,
    },
  };
}

export function extractBearerToken(authorization: string | undefined): string | null {
  if (!authorization) {
    return null;
  }
  const [scheme, token] = authorization.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    return null;
  }
  return token.trim();
}
