import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { users } from '@project-knowledge-hub/database';
import { eq } from 'drizzle-orm';
import { AppError } from '@project-knowledge-hub/domain';
import {
  MCP_SCOPES,
  oauthIssuerFromResourceUrl,
  oauthProtectedResourceMetadataUrl,
  oauthResourceUrlFromMcpUrl,
  type McpScope,
} from '@project-knowledge-hub/mcp';
import { requireSystemAdmin } from '@project-knowledge-hub/permissions';
import {
  assertMutatingOrigin,
  requireAuthenticated,
} from '../plugins/auth.js';
import {
  assertUserMemberOfWorkspaces,
  assertWriteClientConfig,
} from '../lib/api-clients.js';
import { resolveMcpPublicUrl } from '../lib/mcp-public-url.js';
import {
  consumeAuthorizationCode,
  insertAuthorizationCode,
  listOauthGrants,
  loadActiveGrantForAccessToken,
  revokeOauthGrant,
  rotateRefreshToken,
} from '../lib/oauth-grants.js';
import {
  readOauthSigningKey,
  signOauthAccessToken,
  verifyOauthAccessToken,
} from '../lib/oauth-jwt.js';
import {
  getStoredOauthMcpSettings,
  isOauthMcpEffectivelyEnabled,
  saveOauthMcpSettings,
  signingStatus,
  type PublicOauthMcpSettings,
  type StoredOauthMcpSettings,
} from '../lib/oauth-mcp-settings.js';
import { publishedRedirectMatches, redirectAllowed } from '../lib/oauth-redirect.js';

const TXN_TTL_SECONDS = 10 * 60;
const scopeSchema = z.enum(
  MCP_SCOPES as unknown as [McpScope, ...McpScope[]],
);

type AuthorizeTxn = {
  clientId: string;
  redirectUri: string;
  resource: string;
  state?: string;
  codeChallenge: string;
  requestedScopes: string[];
  offlineAccess: boolean;
};

type CimdDocument = {
  redirect_uris?: string[];
};

function txnKey(id: string): string {
  return `oauth:txn:${id}`;
}

function cimdKey(clientId: string): string {
  return `oauth:cimd:${createHash('sha256').update(clientId).digest('hex')}`;
}

function clientAllowed(clientId: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => clientId.startsWith(prefix));
}

function oauthError(
  reply: FastifyReply,
  status: number,
  error: string,
  description: string,
) {
  return reply.status(status).send({ error, error_description: description });
}

function redirectAuth(
  reply: FastifyReply,
  redirectUri: string,
  issuer: string,
  params: Record<string, string | undefined>,
) {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) {
    if (value) {
      url.searchParams.set(key, value);
    }
  }
  url.searchParams.set('iss', issuer);
  return reply.redirect(url.toString());
}

async function resourceContext(app: FastifyInstance) {
  const resolved = await resolveMcpPublicUrl(app.database, app.env);
  const resourceUrl = oauthResourceUrlFromMcpUrl(resolved.mcpUrl);
  const issuer = oauthIssuerFromResourceUrl(resourceUrl);
  return {
    resourceUrl,
    issuer,
    metadataUrl: oauthProtectedResourceMetadataUrl(resourceUrl),
    authorizationEndpoint: `${issuer}/oauth/authorize`,
    tokenEndpoint: `${issuer}/oauth/token`,
    userinfoEndpoint: `${issuer}/oauth/userinfo`,
    jwksUri: `${issuer}/oauth/jwks`,
  };
}

async function publicSettings(app: FastifyInstance): Promise<PublicOauthMcpSettings> {
  const stored = await getStoredOauthMcpSettings(app.database);
  const signing = signingStatus(app.env);
  const urls = await resourceContext(app);
  return {
    ...stored,
    effectiveEnabled: isOauthMcpEffectivelyEnabled(stored, app.env),
    signingKeyConfigured: signing.configured,
    signingKeyFingerprint: signing.fingerprint,
    resourceUrl: urls.resourceUrl,
    issuer: urls.issuer,
    metadataUrl: urls.metadataUrl,
    authorizationEndpoint: urls.authorizationEndpoint,
    tokenEndpoint: urls.tokenEndpoint,
  };
}

async function loadCimd(app: FastifyInstance, clientId: string): Promise<CimdDocument | null> {
  const cached = await app.redis.get(cimdKey(clientId));
  if (cached) {
    return JSON.parse(cached) as CimdDocument;
  }
  const response = await fetch(clientId, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) {
    return null;
  }
  const document = (await response.json()) as CimdDocument;
  await app.redis.set(cimdKey(clientId), JSON.stringify(document), 'EX', TXN_TTL_SECONDS);
  return document;
}

function filterScopes(
  requested: string[],
  ceiling: string[],
): { scopes: string[]; offlineAccess: boolean } {
  const allowed = new Set(ceiling);
  const scopes = requested.filter(
    (scope): scope is McpScope =>
      scope !== 'offline_access' && allowed.has(scope) && (MCP_SCOPES as readonly string[]).includes(scope),
  );
  return {
    scopes,
    offlineAccess: requested.includes('offline_access'),
  };
}

export async function registerOauthMcpRoutes(app: FastifyInstance): Promise<void> {
  if (!app.hasContentTypeParser('application/x-www-form-urlencoded')) {
    app.addContentTypeParser(
      'application/x-www-form-urlencoded',
      { parseAs: 'string' },
      (_request, body, done) => {
        try {
          const text = typeof body === 'string' ? body : body.toString('utf8');
          const params = new URLSearchParams(text);
          const parsed: Record<string, string> = {};
          for (const [key, value] of params.entries()) {
            parsed[key] = value;
          }
          done(null, parsed);
        } catch (error) {
          done(error as Error, undefined);
        }
      },
    );
  }

  app.get('/.well-known/oauth-authorization-server', async () => {
    const stored = await getStoredOauthMcpSettings(app.database);
    const urls = await resourceContext(app);
    return {
      issuer: urls.issuer,
      authorization_endpoint: urls.authorizationEndpoint,
      token_endpoint: urls.tokenEndpoint,
      jwks_uri: urls.jwksUri,
      userinfo_endpoint: urls.userinfoEndpoint,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
      scopes_supported: [...stored.scopeCeiling, 'offline_access'],
    };
  });

  app.get('/.well-known/oauth-protected-resource/mcp/oauth', async () => {
    const stored = await getStoredOauthMcpSettings(app.database);
    const urls = await resourceContext(app);
    return {
      resource: urls.resourceUrl,
      authorization_servers: [urls.issuer],
      scopes_supported: [...stored.scopeCeiling, 'offline_access'],
      bearer_methods_supported: ['header'],
      resource_documentation: `${urls.issuer}/`,
    };
  });

  app.get('/oauth/jwks', async (_request, reply) => {
    const material = readOauthSigningKey(app.env.OAUTH_JWT_PRIVATE_KEY);
    if (!material) {
      return reply.status(404).send({ error: 'signing_key_unavailable' });
    }
    return { keys: [material.jwk] };
  });

  app.get('/oauth/authorize', async (request, reply) => {
    const query = z
      .object({
        response_type: z.string(),
        client_id: z.string().min(1),
        redirect_uri: z.string().min(1),
        code_challenge: z.string().min(1),
        code_challenge_method: z.string(),
        resource: z.string().min(1),
        scope: z.string().optional(),
        state: z.string().optional(),
      })
      .parse(request.query);

    const stored = await getStoredOauthMcpSettings(app.database);
    const urls = await resourceContext(app);
    const trustedRedirect = redirectAllowed(query.redirect_uri, stored.redirectUris);
    const fail = (error: string, description: string) => {
      if (!trustedRedirect) {
        return oauthError(reply, 400, error, description);
      }
      return redirectAuth(reply, query.redirect_uri, urls.issuer, {
        error,
        error_description: description,
        state: query.state,
      });
    };

    if (!isOauthMcpEffectivelyEnabled(stored, app.env)) {
      return fail('access_denied', 'OAuth MCP resource is disabled');
    }
    if (query.response_type !== 'code') {
      return fail('unsupported_response_type', 'Only authorization code is supported');
    }
    if (query.resource !== urls.resourceUrl) {
      return fail('invalid_target', 'resource does not match this MCP server');
    }
    if (query.code_challenge_method !== 'S256') {
      return fail('invalid_request', 'PKCE S256 is required');
    }
    let clientUrl: URL;
    try {
      clientUrl = new URL(query.client_id);
    } catch {
      return fail('invalid_client', 'client_id must be an https metadata URL');
    }
    if (clientUrl.protocol !== 'https:' || !clientAllowed(query.client_id, stored.clientIdPrefixes)) {
      return fail('invalid_client', 'client_id is not allowed');
    }
    const document = await loadCimd(app, query.client_id).catch(() => null);
    if (!publishedRedirectMatches(query.redirect_uri, document?.redirect_uris)) {
      return fail('invalid_client', 'redirect_uri is not published by the client metadata');
    }
    const requested = (query.scope ?? stored.scopeCeiling.join(' ')).split(/\s+/).filter(Boolean);
    const filtered = filterScopes(requested, stored.scopeCeiling);
    if (filtered.scopes.length === 0) {
      return fail('invalid_scope', 'No requested scope is allowed');
    }

    const txn: AuthorizeTxn = {
      clientId: query.client_id,
      redirectUri: query.redirect_uri,
      resource: query.resource,
      state: query.state,
      codeChallenge: query.code_challenge,
      requestedScopes: filtered.scopes,
      offlineAccess: filtered.offlineAccess || requested.includes('offline_access'),
    };
    const txnId = randomUUID();
    await app.redis.set(txnKey(txnId), JSON.stringify(txn), 'EX', TXN_TTL_SECONDS);
    const next = `/oauth/consent?txn=${encodeURIComponent(txnId)}`;
    if (!request.principal) {
      const login = new URL('/login', urls.issuer);
      login.searchParams.set('next', next);
      return reply.redirect(login.toString());
    }
    return reply.redirect(new URL(next, urls.issuer).toString());
  });

  app.get('/api/v1/oauth/consent-request', async (request) => {
    const principal = requireAuthenticated(request);
    const query = z.object({ txn: z.string().uuid() }).parse(request.query);
    const raw = await app.redis.get(txnKey(query.txn));
    if (!raw) {
      throw new AppError({
        code: 'OAUTH_TXN_EXPIRED',
        message: 'This sign-in request expired. Start again from ChatGPT.',
        statusCode: 400,
      });
    }
    const txn = JSON.parse(raw) as AuthorizeTxn;
    const [user] = await app.database.db
      .select()
      .from(users)
      .where(eq(users.id, principal.userId))
      .limit(1);
    return {
      txn: query.txn,
      clientHost: new URL(txn.clientId).host,
      resource: txn.resource,
      scopes: txn.requestedScopes,
      systemUser: user?.userType === 'system',
    };
  });

  app.post('/api/v1/oauth/consent', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    const body = z
      .object({
        txn: z.string().uuid(),
        scopes: z.array(scopeSchema).min(1).max(20),
        allowedWorkspaceIds: z.array(z.string().uuid()).max(100),
      })
      .parse(request.body);
    const raw = await app.redis.get(txnKey(body.txn));
    if (!raw) {
      throw new AppError({
        code: 'OAUTH_TXN_EXPIRED',
        message: 'This sign-in request expired. Start again from ChatGPT.',
        statusCode: 400,
      });
    }
    const txn = JSON.parse(raw) as AuthorizeTxn;
    const [user] = await app.database.db
      .select()
      .from(users)
      .where(eq(users.id, principal.userId))
      .limit(1);
    if (!user || user.status !== 'active' || user.userType === 'system') {
      throw new AppError({
        code: 'FORBIDDEN',
        message: 'This account cannot connect ChatGPT',
        statusCode: 403,
      });
    }
    const scopes = body.scopes.filter((scope) => txn.requestedScopes.includes(scope));
    if (scopes.length === 0) {
      throw new AppError({
        code: 'VALIDATION_ERROR',
        message: 'Choose at least one allowed scope',
        statusCode: 400,
      });
    }
    assertWriteClientConfig({
      scopes,
      actingUserId: principal.userId,
      allowedWorkspaceIds: body.allowedWorkspaceIds,
    });
    const { organizationId } = await assertUserMemberOfWorkspaces(
      app.database,
      principal.userId,
      body.allowedWorkspaceIds,
    );
    const code = await insertAuthorizationCode(app.database, {
      userId: principal.userId,
      organizationId,
      clientId: txn.clientId,
      redirectUri: txn.redirectUri,
      resource: txn.resource,
      scopes,
      allowedWorkspaceIds: body.allowedWorkspaceIds,
      allowedProjectIds: [],
      codeChallenge: txn.codeChallenge,
    });
    await app.redis.del(txnKey(body.txn));
    const urls = await resourceContext(app);
    const redirectTo = new URL(txn.redirectUri);
    redirectTo.searchParams.set('code', code);
    redirectTo.searchParams.set('iss', urls.issuer);
    if (txn.state) {
      redirectTo.searchParams.set('state', txn.state);
    }
    return { redirectTo: redirectTo.toString() };
  });

  app.post('/oauth/token', async (request, reply) => {
    const body = z
      .object({
        grant_type: z.string(),
        code: z.string().optional(),
        redirect_uri: z.string().optional(),
        client_id: z.string().min(1),
        code_verifier: z.string().optional(),
        refresh_token: z.string().optional(),
        resource: z.string().min(1),
      })
      .parse(request.body ?? {});
    const stored = await getStoredOauthMcpSettings(app.database);
    const urls = await resourceContext(app);
    const material = readOauthSigningKey(app.env.OAUTH_JWT_PRIVATE_KEY);
    if (!isOauthMcpEffectivelyEnabled(stored, app.env) || !material) {
      return oauthError(reply, 400, 'invalid_client', 'OAuth MCP resource is disabled');
    }
    if (body.resource !== urls.resourceUrl) {
      return oauthError(reply, 400, 'invalid_target', 'resource does not match this MCP server');
    }
    if (!clientAllowed(body.client_id, stored.clientIdPrefixes)) {
      return oauthError(reply, 400, 'invalid_client', 'client_id is not allowed');
    }

    let grantId = '';
    let userId = '';
    let scopes: string[] = [];
    let refreshToken = '';
    if (body.grant_type === 'authorization_code') {
      if (!body.code || !body.redirect_uri || !body.code_verifier) {
        return oauthError(reply, 400, 'invalid_request', 'code, redirect_uri, and code_verifier are required');
      }
      const consumed = await consumeAuthorizationCode(app.database, {
        code: body.code,
        clientId: body.client_id,
        redirectUri: body.redirect_uri,
        resource: body.resource,
        codeVerifier: body.code_verifier,
        refreshTtlSeconds: app.env.OAUTH_REFRESH_TOKEN_TTL_SECONDS,
      });
      if (!consumed) {
        return oauthError(reply, 400, 'invalid_grant', 'Authorization code is invalid or expired');
      }
      grantId = consumed.grant.id;
      userId = consumed.grant.userId;
      scopes = consumed.grant.scopes;
      refreshToken = consumed.refreshToken;
    } else if (body.grant_type === 'refresh_token') {
      if (!body.refresh_token) {
        return oauthError(reply, 400, 'invalid_request', 'refresh_token is required');
      }
      const rotated = await rotateRefreshToken(app.database, {
        refreshToken: body.refresh_token,
        clientId: body.client_id,
        resource: body.resource,
        refreshTtlSeconds: app.env.OAUTH_REFRESH_TOKEN_TTL_SECONDS,
      });
      if (!rotated) {
        return oauthError(reply, 400, 'invalid_grant', 'Refresh token is invalid or expired');
      }
      grantId = rotated.grant.id;
      userId = rotated.grant.userId;
      scopes = rotated.grant.scopes;
      refreshToken = rotated.refreshToken;
    } else {
      return oauthError(reply, 400, 'unsupported_grant_type', 'Unsupported grant_type');
    }

    const now = Math.floor(Date.now() / 1000);
    const accessToken = signOauthAccessToken(material, {
      iss: urls.issuer,
      sub: userId,
      aud: urls.resourceUrl,
      iat: now,
      nbf: now,
      exp: now + app.env.OAUTH_ACCESS_TOKEN_TTL_SECONDS,
      scope: [...scopes, 'offline_access'].join(' '),
      grant_id: grantId,
      client_id: body.client_id,
    });
    reply.header('cache-control', 'no-store');
    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: app.env.OAUTH_ACCESS_TOKEN_TTL_SECONDS,
      refresh_token: refreshToken,
      scope: [...scopes, 'offline_access'].join(' '),
    };
  });

  app.get('/oauth/userinfo', async (request, reply) => {
    const urls = await resourceContext(app);
    const loaded = await loadGrantFromAuthorization(app, request.headers.authorization, urls);
    if (!loaded) {
      reply.header(
        'WWW-Authenticate',
        `Bearer resource_metadata="${urls.metadataUrl}", error="invalid_token"`,
      );
      return reply.status(401).send({ error: 'invalid_token' });
    }
    return {
      sub: loaded.profile.id,
      email: loaded.profile.email,
      email_verified: true,
      name: loaded.profile.name,
    };
  });

  app.get('/api/v1/oauth/grants', async (request) => {
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);
    return { grants: await listOauthGrants(app.database) };
  });

  app.post('/api/v1/oauth/grants/:grantId/revoke', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);
    const params = z.object({ grantId: z.string().uuid() }).parse(request.params);
    const revoked = await revokeOauthGrant(app.database, params.grantId);
    if (!revoked) {
      throw new AppError({
        code: 'OAUTH_GRANT_NOT_FOUND',
        message: 'OAuth grant not found',
        statusCode: 404,
      });
    }
    return { ok: true };
  });

  app.get('/api/v1/me/oauth/grants', async (request) => {
    const principal = requireAuthenticated(request);
    return { grants: await listOauthGrants(app.database, { userId: principal.userId }) };
  });

  app.post('/api/v1/me/oauth/grants/:grantId/revoke', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    const params = z.object({ grantId: z.string().uuid() }).parse(request.params);
    const revoked = await revokeOauthGrant(app.database, params.grantId, principal.userId);
    if (!revoked) {
      throw new AppError({
        code: 'OAUTH_GRANT_NOT_FOUND',
        message: 'OAuth grant not found',
        statusCode: 404,
      });
    }
    return { ok: true };
  });

  app.get('/api/v1/admin/oauth-mcp-settings', async (request) => {
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);
    return publicSettings(app);
  });

  app.put('/api/v1/admin/oauth-mcp-settings', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);
    const body = z
      .object({
        enabled: z.boolean(),
        redirectUris: z.array(z.string().min(1)).min(1).max(20),
        clientIdPrefixes: z.array(z.string().min(1)).min(1).max(20),
        scopeCeiling: z.array(scopeSchema).min(1).max(20),
      })
      .parse(request.body);
    const stored: StoredOauthMcpSettings = {
      enabled: body.enabled,
      redirectUris: body.redirectUris,
      clientIdPrefixes: body.clientIdPrefixes,
      scopeCeiling: body.scopeCeiling,
    };
    await saveOauthMcpSettings(app.database, stored, principal.userId);
    return publicSettings(app);
  });
}

export async function loadGrantFromAuthorization(
  app: FastifyInstance,
  authorization: string | undefined,
  urls?: { issuer: string; resourceUrl: string },
) {
  const token = authorization?.split(' ')[1]?.trim();
  if (!token || token.startsWith('kh_') || token.split('.').length !== 3) {
    return null;
  }
  const material = readOauthSigningKey(app.env.OAUTH_JWT_PRIVATE_KEY);
  if (!material) {
    return null;
  }
  const resolved = urls ?? (await resourceContext(app));
  const claims = verifyOauthAccessToken(material, token, {
    issuer: resolved.issuer,
    audience: resolved.resourceUrl,
  });
  if (!claims) {
    return null;
  }
  return loadActiveGrantForAccessToken(app.database, {
    grantId: claims.grant_id,
    userId: claims.sub,
    resource: resolved.resourceUrl,
  });
}
