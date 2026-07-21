import { randomBytes } from 'node:crypto';
import { and, eq, isNull, or } from 'drizzle-orm';
import { createSessionToken, hashSessionToken } from '@project-knowledge-hub/auth';
import {
  aiPairingCodes,
  apiClients,
  memberships,
  users,
  workspaces,
  type Database,
} from '@project-knowledge-hub/database';
import { AppError } from '@project-knowledge-hub/domain';
import {
  DEFAULT_MCP_SCOPES,
  buildAntigravityMcpConfig,
  buildChatGptActionsMeta,
  buildCursorMcpConfig,
  buildGeminiMcpConfig,
  buildOpenWebUiMcpConfig,
  llmOpenApiUrlFromMcpUrl,
} from '@project-knowledge-hub/mcp';
import type { AppEnv } from '@project-knowledge-hub/config';
import { getDefaultOrganization } from './identity.js';
import {
  publicOriginFromWebUrl,
  resolveMcpPublicUrl,
} from './mcp-public-url.js';
import { toPublicApiClient } from './api-clients.js';

export const PAIRING_CODE_TTL_SECONDS = 15 * 60;

const PAIRING_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function createPairingCode(length = 10): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += PAIRING_ALPHABET[bytes[i]! % PAIRING_ALPHABET.length];
  }
  return out;
}

export function normalizePairingCode(code: string): string {
  return code.trim().toUpperCase().replace(/[\s-]/g, '');
}

export async function mintAiPairingCode(
  database: Database,
  userId: string,
): Promise<{ code: string; expiresAt: Date }> {
  const [user] = await database.db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user || user.status !== 'active') {
    throw new AppError({
      code: 'USER_INACTIVE',
      message: 'Only active users can create AI pairing codes',
      statusCode: 400,
    });
  }

  await database.db
    .update(aiPairingCodes)
    .set({ consumedAt: new Date() })
    .where(
      and(eq(aiPairingCodes.userId, userId), isNull(aiPairingCodes.consumedAt)),
    );

  const code = createPairingCode();
  const expiresAt = new Date(Date.now() + PAIRING_CODE_TTL_SECONDS * 1000);

  await database.db.insert(aiPairingCodes).values({
    userId,
    codeHash: hashSessionToken(normalizePairingCode(code)),
    expiresAt,
  });

  return { code, expiresAt };
}

export async function resolveOrganizationForUser(
  database: Database,
  userId: string,
): Promise<string> {
  const [membershipOrg] = await database.db
    .select({ organizationId: workspaces.organizationId })
    .from(memberships)
    .innerJoin(workspaces, eq(memberships.workspaceId, workspaces.id))
    .where(and(eq(memberships.userId, userId), isNull(workspaces.archivedAt)))
    .limit(1);

  if (membershipOrg?.organizationId) {
    return membershipOrg.organizationId;
  }

  const organization = await getDefaultOrganization(database);
  if (!organization) {
    throw new AppError({
      code: 'ORGANIZATION_NOT_FOUND',
      message: 'No organization available for API client request',
      statusCode: 400,
    });
  }

  return organization.id;
}

export async function createAiDiscoverRequest(
  database: Database,
  input: {
    pairingCode: string;
    name: string;
    description?: string | null;
    agentLabel?: string | null;
    requestWrite?: boolean;
  },
): Promise<{
  requestId: string;
  claimSecret: string;
  status: string;
  apiClient: ReturnType<typeof toPublicApiClient>;
}> {
  const normalized = normalizePairingCode(input.pairingCode);
  if (normalized.length < 8) {
    throw new AppError({
      code: 'INVALID_PAIRING_CODE',
      message: 'Invalid pairing code',
      statusCode: 400,
    });
  }

  const codeHash = hashSessionToken(normalized);
  const [pairing] = await database.db
    .select()
    .from(aiPairingCodes)
    .where(and(eq(aiPairingCodes.codeHash, codeHash), isNull(aiPairingCodes.consumedAt)))
    .limit(1);

  if (!pairing) {
    throw new AppError({
      code: 'INVALID_PAIRING_CODE',
      message: 'Invalid or already used pairing code',
      statusCode: 400,
    });
  }

  if (pairing.expiresAt.getTime() < Date.now()) {
    throw new AppError({
      code: 'PAIRING_CODE_EXPIRED',
      message: 'Pairing code has expired',
      statusCode: 400,
    });
  }

  const [user] = await database.db
    .select()
    .from(users)
    .where(eq(users.id, pairing.userId))
    .limit(1);

  if (!user || user.status !== 'active') {
    throw new AppError({
      code: 'USER_INACTIVE',
      message: 'Pairing user is not active',
      statusCode: 400,
    });
  }

  const organizationId = await resolveOrganizationForUser(database, user.id);
  const claimSecret = createSessionToken();
  const scopes = input.requestWrite
    ? [...DEFAULT_MCP_SCOPES, 'knowledge:write']
    : [...DEFAULT_MCP_SCOPES];

  const [created] = await database.db
    .insert(apiClients)
    .values({
      organizationId,
      name: input.name.trim().slice(0, 160),
      description: input.description?.trim().slice(0, 1000) || null,
      tokenHash: null,
      tokenPrefix: null,
      scopes,
      allowedWorkspaceIds: [],
      allowedProjectIds: [],
      actingUserId: user.id,
      status: 'pending_approval',
      requestedByUserId: user.id,
      agentLabel: input.agentLabel?.trim().slice(0, 64) || null,
      claimSecretHash: hashSessionToken(claimSecret),
    })
    .returning();

  if (!created) {
    throw new AppError({
      code: 'API_CLIENT_CREATE_FAILED',
      message: 'Failed to create API client request',
      statusCode: 500,
    });
  }

  await database.db
    .update(aiPairingCodes)
    .set({ consumedAt: new Date() })
    .where(eq(aiPairingCodes.id, pairing.id));

  return {
    requestId: created.id,
    claimSecret,
    status: created.status,
    apiClient: toPublicApiClient(created),
  };
}

export async function claimAiDiscoverRequest(
  database: Database,
  env: AppEnv,
  input: {
    requestId: string;
    claimSecret: string;
  },
): Promise<Record<string, unknown>> {
  const [client] = await database.db
    .select()
    .from(apiClients)
    .where(eq(apiClients.id, input.requestId))
    .limit(1);

  if (!client || !client.claimSecretHash) {
    throw new AppError({
      code: 'API_CLIENT_NOT_FOUND',
      message: 'API client request not found',
      statusCode: 404,
    });
  }

  if (client.claimSecretHash !== hashSessionToken(input.claimSecret)) {
    throw new AppError({
      code: 'INVALID_CLAIM_SECRET',
      message: 'Invalid claim secret',
      statusCode: 403,
    });
  }

  const mcpResolved = await resolveMcpPublicUrl(database, env);
  const mcpUrl = mcpResolved.mcpUrl;
  const openapiUrl = llmOpenApiUrlFromMcpUrl(mcpUrl);
  const includeWrite = client.scopes.includes('knowledge:write');

  if (client.status === 'pending_approval') {
    return {
      status: 'pending_approval',
      requestId: client.id,
      apiClient: toPublicApiClient(client),
      mcpUrl,
      openapiUrl,
    };
  }

  if (client.status === 'rejected' || client.revokedAt) {
    return {
      status: client.revokedAt ? 'revoked' : 'rejected',
      requestId: client.id,
      apiClient: toPublicApiClient(client),
      mcpUrl,
      openapiUrl,
    };
  }

  if (client.status !== 'active') {
    return {
      status: client.status,
      requestId: client.id,
      apiClient: toPublicApiClient(client),
      mcpUrl,
      openapiUrl,
    };
  }

  let token: string | null = null;
  if (client.unclaimedToken && !client.tokenClaimedAt) {
    token = client.unclaimedToken;
    await database.db
      .update(apiClients)
      .set({
        unclaimedToken: null,
        tokenClaimedAt: new Date(),
      })
      .where(eq(apiClients.id, client.id));
  }

  const schemaOptions = {
    mcpUrl,
    token: token ?? 'YOUR_TOKEN',
    includeWriteTools: includeWrite,
  };

  const agentLabel = (client.agentLabel ?? '').toLowerCase();
  let suggestedConfig: Record<string, unknown> | null = null;
  if (agentLabel.includes('cursor')) {
    suggestedConfig = buildCursorMcpConfig(schemaOptions);
  } else if (agentLabel.includes('chatgpt') || agentLabel.includes('openai')) {
    suggestedConfig = buildChatGptActionsMeta(schemaOptions) as unknown as Record<
      string,
      unknown
    >;
  } else if (
    agentLabel.includes('antigravity') ||
    agentLabel.includes('agy')
  ) {
    suggestedConfig = buildAntigravityMcpConfig(schemaOptions);
  } else if (agentLabel.includes('gemini')) {
    suggestedConfig = buildGeminiMcpConfig(schemaOptions);
  } else if (agentLabel.includes('openwebui') || agentLabel.includes('open-webui')) {
    suggestedConfig = buildOpenWebUiMcpConfig(schemaOptions);
  } else if (token) {
    suggestedConfig = buildCursorMcpConfig(schemaOptions);
  }

  return {
    status: 'active',
    requestId: client.id,
    apiClient: toPublicApiClient({
      ...client,
      unclaimedToken: null,
      tokenClaimedAt: token ? new Date() : client.tokenClaimedAt,
    }),
    token,
    tokenAlreadyClaimed: !token,
    mcpUrl,
    openapiUrl,
    suggestedConfig,
  };
}

export async function buildAiDiscoverDocument(
  database: Database,
  env: AppEnv,
): Promise<Record<string, unknown>> {
  const mcpResolved = await resolveMcpPublicUrl(database, env);
  const mcpUrl = mcpResolved.mcpUrl;
  const publicApiBase = publicOriginFromWebUrl(env.WEB_URL);
  const webDiscoverUrl = `${publicApiBase}/ai-discover`;
  // Prefer WEB_URL for HTTP API paths — API_URL is often an internal Compose host.
  const openapiUrl = `${publicApiBase}/api/v1/llm/openapi.json`;
  const discoverUrl = `${publicApiBase}/api/v1/ai-discover`;
  const createRequestUrl = `${publicApiBase}/api/v1/ai-discover/requests`;
  const claimOrPollUrl =
    `${publicApiBase}/api/v1/ai-discover/requests/{requestId}?claimSecret={claimSecret}`;

  return {
    service: 'project-knowledge-hub',
    purpose: 'AI agent autodiscovery for MCP / OpenAPI API client pairing',
    webDiscoverUrl,
    publicApiBase,
    mcpUrl,
    openapiUrl,
    pairingCodeTtlSeconds: PAIRING_CODE_TTL_SECONDS,
    defaultScopes: [...DEFAULT_MCP_SCOPES],
    steps: [
      'User creates an active account in the Knowledge Hub and signs in.',
      'User opens Profile → Connect AI (or /account/ai-connections) and generates a pairing code.',
      'User pastes the pairing code and this discover URL into the AI chat.',
      `AI calls POST ${createRequestUrl} with the pairing code.`,
      'User or a system admin approves the pending request in the hub.',
      `AI polls GET ${claimOrPollUrl} until approved, then saves the bearer token.`,
      `AI uses Authorization: Bearer <token> against ${mcpUrl} or ${publicApiBase}/api/v1/llm/tools/:toolName.`,
    ],
    endpoints: {
      discover: discoverUrl,
      createRequest: createRequestUrl,
      claimOrPoll: claimOrPollUrl,
      mintPairingCode: `${publicApiBase}/api/v1/me/ai-pairing-codes (session auth)`,
      listMyClients: `${publicApiBase}/api/v1/me/api-clients (session auth)`,
    },
    createRequestBody: {
      pairingCode: 'string (from user)',
      name: 'string (agent / connection label)',
      description: 'optional string',
      agentLabel: 'optional: cursor | chatgpt | antigravity | gemini | openwebui | …',
      requestWrite: 'optional boolean — requests knowledge:write (still needs approval + workspaces)',
    },
  };
}

export function assertOwnsApiClient(
  client: typeof apiClients.$inferSelect,
  userId: string,
): void {
  const ownerId = client.requestedByUserId ?? client.actingUserId;
  if (ownerId !== userId) {
    throw new AppError({
      code: 'FORBIDDEN',
      message: 'You do not own this API client',
      statusCode: 403,
    });
  }
}

export function userOwnsClientFilter(userId: string) {
  return or(
    eq(apiClients.requestedByUserId, userId),
    eq(apiClients.actingUserId, userId),
  );
}
