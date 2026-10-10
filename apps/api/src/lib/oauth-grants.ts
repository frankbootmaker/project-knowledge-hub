import { createHash, randomBytes } from 'node:crypto';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { hashSessionToken } from '@project-knowledge-hub/auth';
import {
  oauthAuthorizationCodes,
  oauthGrants,
  oauthRefreshTokens,
  users,
  type Database,
} from '@project-knowledge-hub/database';
import type { McpClientContext } from '@project-knowledge-hub/mcp';

const CODE_TTL_MS = 5 * 60 * 1000;

export type PublicOauthGrant = {
  id: string;
  userId: string;
  userEmail: string | null;
  userDisplayName: string | null;
  organizationId: string;
  clientId: string;
  clientHost: string;
  resource: string;
  scopes: string[];
  allowedWorkspaceIds: string[];
  allowedProjectIds: string[];
  status: string;
  lastUsedAt: string | null;
  refreshExpiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

function clientHost(clientId: string): string {
  try {
    return new URL(clientId).host;
  } catch {
    return clientId;
  }
}

export function toPublicOauthGrant(
  grant: typeof oauthGrants.$inferSelect,
  user?: { email: string; displayName: string } | null,
): PublicOauthGrant {
  return {
    id: grant.id,
    userId: grant.userId,
    userEmail: user?.email ?? null,
    userDisplayName: user?.displayName ?? null,
    organizationId: grant.organizationId,
    clientId: grant.clientId,
    clientHost: clientHost(grant.clientId),
    resource: grant.resource,
    scopes: grant.scopes,
    allowedWorkspaceIds: grant.allowedWorkspaceIds,
    allowedProjectIds: grant.allowedProjectIds,
    status: grant.revokedAt ? 'revoked' : grant.status,
    lastUsedAt: grant.lastUsedAt?.toISOString() ?? null,
    refreshExpiresAt: grant.refreshExpiresAt?.toISOString() ?? null,
    revokedAt: grant.revokedAt?.toISOString() ?? null,
    createdAt: grant.createdAt.toISOString(),
  };
}

export function pkceS256(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export function issueOpaqueToken(prefix: string): {
  token: string;
  tokenHash: string;
  tokenPrefix: string;
} {
  const token = `${prefix}_${randomBytes(32).toString('base64url')}`;
  return {
    token,
    tokenHash: hashSessionToken(token),
    tokenPrefix: token.slice(0, 12),
  };
}

export async function listOauthGrants(
  database: Database,
  filter?: { userId?: string },
): Promise<PublicOauthGrant[]> {
  const rows = await database.db
    .select({
      grant: oauthGrants,
      email: users.email,
      displayName: users.displayName,
    })
    .from(oauthGrants)
    .innerJoin(users, eq(oauthGrants.userId, users.id))
    .where(filter?.userId ? eq(oauthGrants.userId, filter.userId) : undefined)
    .orderBy(desc(oauthGrants.createdAt));
  return rows.map((row) =>
    toPublicOauthGrant(row.grant, { email: row.email, displayName: row.displayName }),
  );
}

export async function revokeOauthGrant(
  database: Database,
  grantId: string,
  userId?: string,
): Promise<typeof oauthGrants.$inferSelect | null> {
  const [existing] = await database.db
    .select()
    .from(oauthGrants)
    .where(eq(oauthGrants.id, grantId))
    .limit(1);
  if (!existing || (userId && existing.userId !== userId)) {
    return null;
  }
  const now = new Date();
  await database.db
    .update(oauthRefreshTokens)
    .set({ revokedAt: now })
    .where(and(eq(oauthRefreshTokens.grantId, grantId), isNull(oauthRefreshTokens.revokedAt)));
  const [updated] = await database.db
    .update(oauthGrants)
    .set({ status: 'revoked', revokedAt: now })
    .where(eq(oauthGrants.id, grantId))
    .returning();
  return updated ?? null;
}

export async function insertAuthorizationCode(
  database: Database,
  input: {
    userId: string;
    organizationId: string;
    clientId: string;
    redirectUri: string;
    resource: string;
    scopes: string[];
    allowedWorkspaceIds: string[];
    allowedProjectIds: string[];
    codeChallenge: string;
  },
): Promise<string> {
  const issued = issueOpaqueToken('oc');
  const expiresAt = new Date(Date.now() + CODE_TTL_MS);
  await database.db.insert(oauthAuthorizationCodes).values({
    codeHash: issued.tokenHash,
    userId: input.userId,
    organizationId: input.organizationId,
    clientId: input.clientId,
    redirectUri: input.redirectUri,
    resource: input.resource,
    scopes: input.scopes,
    allowedWorkspaceIds: input.allowedWorkspaceIds,
    allowedProjectIds: input.allowedProjectIds,
    codeChallenge: input.codeChallenge,
    expiresAt,
  });
  return issued.token;
}

export async function consumeAuthorizationCode(
  database: Database,
  input: {
    code: string;
    clientId: string;
    redirectUri: string;
    resource: string;
    codeVerifier: string;
    refreshTtlSeconds: number;
  },
): Promise<{ grant: typeof oauthGrants.$inferSelect; refreshToken: string } | null> {
  const now = new Date();
  const codeHash = hashSessionToken(input.code);
  const [code] = await database.db
    .select()
    .from(oauthAuthorizationCodes)
    .where(eq(oauthAuthorizationCodes.codeHash, codeHash))
    .limit(1);
  if (!code || code.usedAt || code.expiresAt <= now) {
    return null;
  }
  if (
    code.clientId !== input.clientId
    || code.redirectUri !== input.redirectUri
    || code.resource !== input.resource
  ) {
    return null;
  }
  if (pkceS256(input.codeVerifier) !== code.codeChallenge) {
    return null;
  }

  const refresh = issueOpaqueToken('or');
  const refreshExpiresAt = new Date(now.getTime() + input.refreshTtlSeconds * 1000);
  const consumed = await database.db.transaction(async (tx) => {
    const [marked] = await tx
      .update(oauthAuthorizationCodes)
      .set({ usedAt: now })
      .where(and(eq(oauthAuthorizationCodes.id, code.id), isNull(oauthAuthorizationCodes.usedAt)))
      .returning();
    if (!marked) {
      return null;
    }
    const [grant] = await tx
      .insert(oauthGrants)
      .values({
        userId: code.userId,
        organizationId: code.organizationId,
        clientId: code.clientId,
        resource: code.resource,
        scopes: code.scopes,
        allowedWorkspaceIds: code.allowedWorkspaceIds,
        allowedProjectIds: code.allowedProjectIds,
        status: 'active',
        refreshExpiresAt,
      })
      .returning();
    if (!grant) {
      return null;
    }
    await tx.insert(oauthRefreshTokens).values({
      grantId: grant.id,
      tokenHash: refresh.tokenHash,
      tokenPrefix: refresh.tokenPrefix,
      expiresAt: refreshExpiresAt,
    });
    return grant;
  });
  if (!consumed) {
    return null;
  }
  return { grant: consumed, refreshToken: refresh.token };
}

export async function rotateRefreshToken(
  database: Database,
  input: { refreshToken: string; clientId: string; resource: string; refreshTtlSeconds: number },
): Promise<{ grant: typeof oauthGrants.$inferSelect; refreshToken: string } | null> {
  const now = new Date();
  const tokenHash = hashSessionToken(input.refreshToken);
  const [existing] = await database.db
    .select()
    .from(oauthRefreshTokens)
    .where(eq(oauthRefreshTokens.tokenHash, tokenHash))
    .limit(1);
  if (!existing || existing.revokedAt || existing.expiresAt <= now) {
    return null;
  }
  const [grant] = await database.db
    .select()
    .from(oauthGrants)
    .where(eq(oauthGrants.id, existing.grantId))
    .limit(1);
  if (
    !grant
    || grant.revokedAt
    || grant.status !== 'active'
    || grant.clientId !== input.clientId
    || grant.resource !== input.resource
  ) {
    return null;
  }
  const next = issueOpaqueToken('or');
  const refreshExpiresAt = new Date(now.getTime() + input.refreshTtlSeconds * 1000);
  const rotated = await database.db.transaction(async (tx) => {
    const [revoked] = await tx
      .update(oauthRefreshTokens)
      .set({ revokedAt: now })
      .where(and(eq(oauthRefreshTokens.id, existing.id), isNull(oauthRefreshTokens.revokedAt)))
      .returning();
    if (!revoked) {
      return null;
    }
    await tx.insert(oauthRefreshTokens).values({
      grantId: grant.id,
      tokenHash: next.tokenHash,
      tokenPrefix: next.tokenPrefix,
      expiresAt: refreshExpiresAt,
      rotatedFromId: existing.id,
    });
    await tx
      .update(oauthGrants)
      .set({ refreshExpiresAt, lastUsedAt: now })
      .where(eq(oauthGrants.id, grant.id));
    return grant;
  });
  if (!rotated) {
    return null;
  }
  return { grant: { ...rotated, refreshExpiresAt }, refreshToken: next.token };
}

export async function loadActiveGrantForAccessToken(
  database: Database,
  input: { grantId: string; userId: string; resource: string },
): Promise<(typeof oauthGrants.$inferSelect & {
  context: McpClientContext;
  profile: { id: string; name: string; email: string };
}) | null> {
  const now = new Date();
  const [grant] = await database.db
    .select()
    .from(oauthGrants)
    .where(eq(oauthGrants.id, input.grantId))
    .limit(1);
  if (
    !grant
    || grant.revokedAt
    || grant.status !== 'active'
    || grant.userId !== input.userId
    || grant.resource !== input.resource
  ) {
    return null;
  }
  const [user] = await database.db
    .select()
    .from(users)
    .where(eq(users.id, grant.userId))
    .limit(1);
  if (!user || user.status !== 'active' || user.userType === 'system') {
    return null;
  }
  await database.db
    .update(oauthGrants)
    .set({ lastUsedAt: now })
    .where(eq(oauthGrants.id, grant.id));
  return {
    ...grant,
    context: {
      id: grant.id,
      name: user.displayName,
      organizationId: grant.organizationId,
      scopes: grant.scopes,
      allowedWorkspaceIds: grant.allowedWorkspaceIds,
      allowedProjectIds: grant.allowedProjectIds,
      actingUserId: grant.userId,
    },
    profile: {
      id: user.id,
      name: user.displayName,
      email: user.email,
    },
  };
}
