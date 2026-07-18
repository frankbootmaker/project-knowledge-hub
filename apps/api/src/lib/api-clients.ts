import { and, eq, isNull, or, gt } from 'drizzle-orm';
import { createSessionToken, hashSessionToken } from '@project-knowledge-hub/auth';
import { apiClients, type Database } from '@project-knowledge-hub/database';
import { DEFAULT_MCP_SCOPES, type McpClientContext } from '@project-knowledge-hub/mcp';

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
