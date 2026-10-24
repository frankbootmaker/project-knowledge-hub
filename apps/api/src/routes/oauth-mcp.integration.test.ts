import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { hashPassword } from '@project-knowledge-hub/auth';
import { loadEnv } from '@project-knowledge-hub/config';
import {
  auditEvents,
  createDatabase,
  memberships,
  organizations,
  projects,
  users,
  workspaces,
} from '@project-knowledge-hub/database';
import { buildApp } from '../app.js';
import { closeUserAccount } from '../lib/close-user.js';
import type { FastifyInstance } from 'fastify';

const hasIntegrationEnv = Boolean(process.env.DATABASE_URL) && Boolean(process.env.REDIS_URL);

const REDIRECT = 'https://chatgpt.com/connector_platform_oauth_redirect';
const CLIENT_ID = 'https://chatgpt.com/oauth/client.json';

function signingKey(): string {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
}

function pkce(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

describe.skipIf(!hasIntegrationEnv)('MCP OAuth resource', () => {
  let app: FastifyInstance | undefined;
  let redis: Redis | undefined;
  let closeDatabase: (() => Promise<void>) | undefined;
  let database: ReturnType<typeof createDatabase> | undefined;
  let cookie = '';
  let sessionCookieName = '';
  let userId = '';
  let workspaceId = '';
  let organizationId = '';
  let bearerToken = '';
  const originalFetch = globalThis.fetch;
  const pem = signingKey();

  beforeAll(async () => {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('https://chatgpt.com/oauth/')) {
        return new Response(
          JSON.stringify({
            client_id: url,
            redirect_uris: [REDIRECT],
            token_endpoint_auth_method: 'none',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return originalFetch(input, init);
    }) as typeof fetch;

    const env = loadEnv({
      ...process.env,
      NODE_ENV: 'test',
      APP_ENV: 'test',
      LOG_LEVEL: 'silent',
      SESSION_SECRET: process.env.SESSION_SECRET ?? 'test-session-secret-at-least-32-chars',
      WEB_URL: 'http://localhost:3100',
      OAUTH_JWT_PRIVATE_KEY: pem,
    });
    database = createDatabase(env.DATABASE_URL);
    closeDatabase = () => database!.close();
    redis = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      enableOfflineQueue: false,
      retryStrategy: () => null,
    });
    await redis.connect();

    const suffix = randomUUID();
    const [org] = await database.db
      .insert(organizations)
      .values({ name: `OAuth ${suffix}`, slug: `oauth-${suffix}` })
      .returning();
    const [user] = await database.db
      .insert(users)
      .values({
        email: `oauth-${suffix}@example.com`,
        displayName: 'OAuth User',
        passwordHash: await hashPassword('test-password-123'),
        isSystemAdmin: true,
        status: 'active',
      })
      .returning();
    const [workspace] = await database.db
      .insert(workspaces)
      .values({
        organizationId: org!.id,
        name: 'OAuth WS',
        slug: `oauth-ws-${suffix}`,
      })
      .returning();
    userId = user!.id;
    workspaceId = workspace!.id;
    organizationId = org!.id;
    await database.db.insert(memberships).values({
      userId,
      workspaceId,
      role: 'reader',
    });

    app = await buildApp({ env, database, redis });
    await app.ready();
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: user!.email, password: 'test-password-123' },
    });
    sessionCookieName = env.SESSION_COOKIE_NAME;
    cookie = `${sessionCookieName}=${login.cookies.find((item) => item.name === sessionCookieName)?.value}`;
  });

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    // @hono/node-server drains unread POST bodies on a 500ms timer. Let that
    // timer run while Vitest is still inside this hook.
    await new Promise((resolve) => {
      setTimeout(resolve, 600);
    });
    await app?.close();
    if (redis) {
      try {
        await redis.quit();
      } catch {
        redis.disconnect();
      }
    }
    await closeDatabase?.();
  });

  async function authorize(scope: string, sessionCookie = cookie) {
    const verifier = `verifier-${randomUUID()}`;
    const response = await app!.inject({
      method: 'GET',
      url: '/oauth/authorize',
      headers: { cookie: sessionCookie },
      query: {
        response_type: 'code',
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT,
        code_challenge: pkce(verifier),
        code_challenge_method: 'S256',
        resource: 'http://localhost:3100/mcp/oauth',
        scope,
        state: 'state-1',
      },
    });
    expect(response.statusCode).toBe(302);
    const location = new URL(response.headers.location!);
    return { verifier, txn: location.searchParams.get('txn')! };
  }

  /** Own system admin so this suite can close the shared user without logging later tests out. */
  async function loginFreshAdmin(): Promise<string> {
    const suffix = randomUUID();
    const password = 'test-password-123';
    const [admin] = await database!.db
      .insert(users)
      .values({
        email: `oauth-admin-${suffix}@example.com`,
        displayName: 'OAuth Admin',
        passwordHash: await hashPassword(password),
        isSystemAdmin: true,
        status: 'active',
      })
      .returning();
    await database!.db.insert(memberships).values({
      userId: admin!.id,
      workspaceId,
      role: 'reader',
    });
    const login = await app!.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: admin!.email, password },
    });
    expect(login.statusCode).toBe(200);
    const value = login.cookies.find((item) => item.name === sessionCookieName)?.value;
    expect(value).toBeTruthy();
    return `${sessionCookieName}=${value}`;
  }

  it('keeps root OAuth discovery unpublished and serves the path-scoped document', async () => {
    const root = await app!.inject({
      method: 'GET',
      url: '/.well-known/oauth-protected-resource',
    });
    expect(root.statusCode).toBe(404);
    const scoped = await app!.inject({
      method: 'GET',
      url: '/.well-known/oauth-protected-resource/mcp/oauth',
    });
    expect(scoped.statusCode).toBe(200);
    expect(scoped.json()).toMatchObject({
      resource: 'http://localhost:3100/mcp/oauth',
      authorization_servers: ['http://localhost:3100'],
    });
  });

  it('issues a grant, rejects it on /mcp, and rotates refresh tokens', async () => {
    const enabled = await app!.inject({
      method: 'PUT',
      url: '/api/v1/admin/oauth-mcp-settings',
      headers: { cookie, origin: 'http://localhost:3100' },
      payload: {
        enabled: true,
        redirectUris: [REDIRECT],
        clientIdPrefixes: ['https://chatgpt.com/oauth/'],
        scopeCeiling: ['knowledge:read', 'knowledge:write', 'projects:read'],
      },
    });
    expect(enabled.statusCode).toBe(200);

    const { verifier, txn } = await authorize('knowledge:read offline_access');
    const consent = await app!.inject({
      method: 'POST',
      url: '/api/v1/oauth/consent',
      headers: { cookie, origin: 'http://localhost:3100' },
      payload: {
        txn,
        scopes: ['knowledge:read'],
        allowedWorkspaceIds: [workspaceId],
      },
    });
    expect(consent.statusCode).toBe(200);
    const redirectTo = new URL((consent.json() as { redirectTo: string }).redirectTo);
    expect(redirectTo.searchParams.get('iss')).toBe('http://localhost:3100');
    const code = redirectTo.searchParams.get('code')!;

    const token = await app!.inject({
      method: 'POST',
      url: '/oauth/token',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT,
        client_id: CLIENT_ID,
        code_verifier: verifier,
        resource: 'http://localhost:3100/mcp/oauth',
      }).toString(),
    });
    expect(token.statusCode).toBe(200);
    const issued = token.json() as { access_token: string; refresh_token: string };
    expect(issued.access_token.split('.')).toHaveLength(3);

    const oauthCall = await app!.inject({
      method: 'POST',
      url: '/mcp/oauth',
      headers: {
        authorization: `Bearer ${issued.access_token}`,
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
      },
      payload: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {},
      },
    });
    expect(oauthCall.statusCode).toBe(200);
    const tools = (
      oauthCall.json() as {
        result: {
          tools: Array<{
            name: string;
            _meta?: { securitySchemes?: unknown; 'openai/profile'?: boolean };
          }>;
        };
      }
    ).result.tools;
    expect(tools.some((tool) => tool.name === 'get_profile')).toBe(true);
    expect(tools.find((tool) => tool.name === 'get_profile')?._meta?.['openai/profile']).toBe(true);
    expect(
      tools.find((tool) => tool.name === 'list_workspaces')?._meta?.securitySchemes,
    ).toBeTruthy();

    const bearerMount = await app!.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        authorization: `Bearer ${issued.access_token}`,
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
      },
      payload: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
    });
    expect(bearerMount.statusCode).toBe(401);
    expect(bearerMount.headers['www-authenticate']).toBeUndefined();

    const llmMount = await app!.inject({
      method: 'POST',
      url: '/api/v1/llm/tools/search_knowledge',
      headers: {
        authorization: `Bearer ${issued.access_token}`,
        'content-type': 'application/json',
      },
      payload: { query: 'oauth' },
    });
    expect(llmMount.statusCode).toBe(401);

    const khOnOauth = await app!.inject({
      method: 'POST',
      url: '/mcp/oauth',
      headers: {
        authorization: 'Bearer kh_not_a_grant',
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
      },
      payload: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
    });
    expect(khOnOauth.statusCode).toBe(401);
    expect(String(khOnOauth.headers['www-authenticate'])).toContain(
      'oauth-protected-resource/mcp/oauth',
    );

    const refreshed = await app!.inject({
      method: 'POST',
      url: '/oauth/token',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: issued.refresh_token,
        client_id: CLIENT_ID,
        resource: 'http://localhost:3100/mcp/oauth',
      }).toString(),
    });
    expect(refreshed.statusCode).toBe(200);
    const reused = await app!.inject({
      method: 'POST',
      url: '/oauth/token',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: issued.refresh_token,
        client_id: CLIENT_ID,
        resource: 'http://localhost:3100/mcp/oauth',
      }).toString(),
    });
    expect(reused.statusCode).toBe(200);
    const reusedBody = reused.json() as { access_token: string; refresh_token: string };
    expect(reusedBody.access_token).toBeTruthy();
    expect(reusedBody.refresh_token).not.toBe(issued.refresh_token);
  });

  it('rejects write consent without a workspace and revoke stops the next call', async () => {
    const { txn } = await authorize('knowledge:read knowledge:write');
    const denied = await app!.inject({
      method: 'POST',
      url: '/api/v1/oauth/consent',
      headers: { cookie, origin: 'http://localhost:3100' },
      payload: {
        txn,
        scopes: ['knowledge:write'],
        allowedWorkspaceIds: [],
      },
    });
    expect(denied.statusCode).toBe(400);

    const grants = await app!.inject({
      method: 'GET',
      url: '/api/v1/oauth/grants',
      headers: { cookie },
    });
    const grantId = (
      grants.json() as { grants: Array<{ id: string; status: string }> }
    ).grants.find((grant) => grant.status === 'active')?.id;
    expect(grantId).toBeTruthy();
    const blockedDelete = await app!.inject({
      method: 'DELETE',
      url: `/api/v1/oauth/grants/${grantId}`,
      headers: { cookie, origin: 'http://localhost:3100' },
    });
    expect(blockedDelete.statusCode).toBe(409);
    const revoke = await app!.inject({
      method: 'POST',
      url: `/api/v1/oauth/grants/${grantId}/revoke`,
      headers: { cookie, origin: 'http://localhost:3100' },
    });
    expect(revoke.statusCode).toBe(200);
    const removed = await app!.inject({
      method: 'DELETE',
      url: `/api/v1/oauth/grants/${grantId}`,
      headers: { cookie, origin: 'http://localhost:3100' },
    });
    expect(removed.statusCode).toBe(200);
    const remaining = await app!.inject({
      method: 'GET',
      url: '/api/v1/oauth/grants',
      headers: { cookie },
    });
    expect(
      (remaining.json() as { grants: Array<{ id: string }> }).grants.some(
        (grant) => grant.id === grantId,
      ),
    ).toBe(false);

    const { verifier, txn: nextTxn } = await authorize('knowledge:read');
    const consent = await app!.inject({
      method: 'POST',
      url: '/api/v1/oauth/consent',
      headers: { cookie, origin: 'http://localhost:3100' },
      payload: {
        txn: nextTxn,
        scopes: ['knowledge:read'],
        allowedWorkspaceIds: [workspaceId],
      },
    });
    const code = new URL((consent.json() as { redirectTo: string }).redirectTo).searchParams.get(
      'code',
    )!;
    const token = await app!.inject({
      method: 'POST',
      url: '/oauth/token',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT,
        client_id: CLIENT_ID,
        code_verifier: verifier,
        resource: 'http://localhost:3100/mcp/oauth',
      }).toString(),
    });
    const access = (token.json() as { access_token: string }).access_token;
    const grantsAfter = await app!.inject({
      method: 'GET',
      url: '/api/v1/me/oauth/grants',
      headers: { cookie },
    });
    const mine = (
      grantsAfter.json() as { grants: Array<{ id: string; status: string }> }
    ).grants.find((grant) => grant.status === 'active');
    await app!.inject({
      method: 'POST',
      url: `/api/v1/me/oauth/grants/${mine!.id}/revoke`,
      headers: { cookie, origin: 'http://localhost:3100' },
    });
    const removedMine = await app!.inject({
      method: 'DELETE',
      url: `/api/v1/me/oauth/grants/${mine!.id}`,
      headers: { cookie, origin: 'http://localhost:3100' },
    });
    expect(removedMine.statusCode).toBe(200);
    const blocked = await app!.inject({
      method: 'POST',
      url: '/mcp/oauth',
      headers: {
        authorization: `Bearer ${access}`,
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
      },
      payload: { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    });
    expect(blocked.statusCode).toBe(401);
  });

  it('lets a system admin consent to a workspace they do not belong to', async () => {
    const [extra] = await database!.db
      .insert(workspaces)
      .values({
        organizationId,
        name: 'Admin visible',
        slug: `oauth-admin-${randomUUID()}`,
      })
      .returning();
    const { txn } = await authorize('knowledge:read');
    const consent = await app!.inject({
      method: 'POST',
      url: '/api/v1/oauth/consent',
      headers: { cookie, origin: 'http://localhost:3100' },
      payload: {
        txn,
        scopes: ['knowledge:read'],
        allowedWorkspaceIds: [extra!.id],
      },
    });
    expect(consent.statusCode).toBe(200);
    expect((consent.json() as { redirectTo: string }).redirectTo).toContain('code=');
  });

  it('creates a project from an OAuth grant without an api_clients foreign key', async () => {
    const enabled = await app!.inject({
      method: 'PUT',
      url: '/api/v1/admin/oauth-mcp-settings',
      headers: { cookie, origin: 'http://localhost:3100' },
      payload: {
        enabled: true,
        redirectUris: [REDIRECT],
        clientIdPrefixes: ['https://chatgpt.com/oauth/'],
        scopeCeiling: ['projects:read', 'projects:write'],
      },
    });
    expect(enabled.statusCode).toBe(200);

    const { verifier, txn } = await authorize('projects:read projects:write');
    const consent = await app!.inject({
      method: 'POST',
      url: '/api/v1/oauth/consent',
      headers: { cookie, origin: 'http://localhost:3100' },
      payload: {
        txn,
        scopes: ['projects:read', 'projects:write'],
        allowedWorkspaceIds: [workspaceId],
      },
    });
    expect(consent.statusCode).toBe(200);
    const code = new URL((consent.json() as { redirectTo: string }).redirectTo).searchParams.get(
      'code',
    )!;
    const token = await app!.inject({
      method: 'POST',
      url: '/oauth/token',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT,
        client_id: CLIENT_ID,
        code_verifier: verifier,
        resource: 'http://localhost:3100/mcp/oauth',
      }).toString(),
    });
    expect(token.statusCode).toBe(200);
    const access = (token.json() as { access_token: string }).access_token;

    const grants = await app!.inject({
      method: 'GET',
      url: '/api/v1/oauth/grants',
      headers: { cookie },
    });
    const grant = (
      grants.json() as { grants: Array<{ id: string; status: string; scopes: string[] }> }
    ).grants.find((row) => row.status === 'active' && row.scopes.includes('projects:write'));
    expect(grant?.id).toBeTruthy();

    const created = await app!.inject({
      method: 'POST',
      url: '/mcp/oauth',
      headers: {
        authorization: `Bearer ${access}`,
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
      },
      payload: {
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: {
          name: 'call_hub_tool',
          arguments: {
            toolName: 'create_project',
            arguments: {
              workspaceId,
              name: 'OAuth Idea',
              description: 'Created by a ChatGPT grant',
            },
          },
        },
      },
    });
    expect(created.statusCode).toBe(200);
    const createdText = (
      created.json() as { result?: { isError?: boolean; content?: Array<{ text?: string }> } }
    ).result;
    expect(createdText?.isError).toBeFalsy();
    const createdBody = JSON.parse(createdText?.content?.[0]?.text ?? '{}') as {
      project: {
        id: string;
        status: string;
        createdByApiClientId: string | null;
        createdByOauthGrantId: string | null;
        createdByUserId: string;
      };
    };
    expect(createdBody.project.status).toBe('idea');
    expect(createdBody.project.createdByApiClientId).toBeNull();
    expect(createdBody.project.createdByOauthGrantId).toBe(grant!.id);
    expect(createdBody.project.createdByUserId).toBe(userId);

    const [row] = await database!.db
      .select()
      .from(projects)
      .where(eq(projects.id, createdBody.project.id))
      .limit(1);
    expect(row?.createdByApiClientId).toBeNull();
    expect(row?.createdByOauthGrantId).toBe(grant!.id);
    expect(row?.ownerUserId).toBe(userId);

    const updated = await app!.inject({
      method: 'POST',
      url: '/mcp/oauth',
      headers: {
        authorization: `Bearer ${access}`,
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
      },
      payload: {
        jsonrpc: '2.0',
        id: 8,
        method: 'tools/call',
        params: {
          name: 'call_hub_tool',
          arguments: {
            toolName: 'update_project',
            arguments: {
              projectId: createdBody.project.id,
              description: 'Still an idea',
            },
          },
        },
      },
    });
    expect(updated.statusCode).toBe(200);
    const updatedResult = (
      updated.json() as { result?: { isError?: boolean; content?: Array<{ text?: string }> } }
    ).result;
    expect(updatedResult?.isError).toBeFalsy();

    const audits = await database!.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.entityId, createdBody.project.id));
    expect(audits.map((event) => event.action).sort()).toEqual([
      'project.create',
      'project.update',
    ]);
    expect(audits.every((event) => event.actorType === 'oauth_grant')).toBe(true);
    expect(audits.every((event) => event.actorId === grant!.id)).toBe(true);
  });

  it('disabling OAuth leaves bearer /mcp usable, and closing the user stops a grant', async () => {
    const client = await app!.inject({
      method: 'POST',
      url: '/api/v1/api-clients',
      headers: { cookie, origin: 'http://localhost:3100' },
      payload: {
        organizationId,
        name: 'Bearer stays',
        allowedWorkspaceIds: [workspaceId],
      },
    });
    expect(client.statusCode).toBe(200);
    bearerToken = (client.json() as { token: string }).token;

    const disabled = await app!.inject({
      method: 'PUT',
      url: '/api/v1/admin/oauth-mcp-settings',
      headers: { cookie, origin: 'http://localhost:3100' },
      payload: {
        enabled: false,
        redirectUris: [REDIRECT],
        clientIdPrefixes: ['https://chatgpt.com/oauth/'],
        scopeCeiling: ['knowledge:read'],
      },
    });
    expect(disabled.statusCode).toBe(200);
    const oauthBlocked = await app!.inject({
      method: 'POST',
      url: '/mcp/oauth',
      headers: {
        authorization: `Bearer ${bearerToken}`,
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
      },
      payload: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
    });
    expect(oauthBlocked.statusCode).toBe(403);
    const bearerOk = await app!.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        authorization: `Bearer ${bearerToken}`,
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
      },
      payload: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
    });
    expect(bearerOk.statusCode).toBe(200);

    await app!.inject({
      method: 'PUT',
      url: '/api/v1/admin/oauth-mcp-settings',
      headers: { cookie, origin: 'http://localhost:3100' },
      payload: {
        enabled: true,
        redirectUris: [REDIRECT],
        clientIdPrefixes: ['https://chatgpt.com/oauth/'],
        scopeCeiling: ['knowledge:read'],
      },
    });
    const { verifier, txn } = await authorize('knowledge:read');
    const consent = await app!.inject({
      method: 'POST',
      url: '/api/v1/oauth/consent',
      headers: { cookie, origin: 'http://localhost:3100' },
      payload: { txn, scopes: ['knowledge:read'], allowedWorkspaceIds: [workspaceId] },
    });
    const code = new URL((consent.json() as { redirectTo: string }).redirectTo).searchParams.get(
      'code',
    )!;
    const token = await app!.inject({
      method: 'POST',
      url: '/oauth/token',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT,
        client_id: CLIENT_ID,
        code_verifier: verifier,
        resource: 'http://localhost:3100/mcp/oauth',
      }).toString(),
    });
    const access = (token.json() as { access_token: string }).access_token;
    await closeUserAccount(database!, { userId, avatarUploadDir: '/tmp/kh-oauth-test-avatars' });
    const closed = await app!.inject({
      method: 'POST',
      url: '/mcp/oauth',
      headers: {
        authorization: `Bearer ${access}`,
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
      },
      payload: { jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} },
    });
    expect(closed.statusCode).toBe(401);
  });

  it('PRO-B-52 discovers upload fields and audits the grant as oauth_grant', async () => {
    const adminCookie = await loginFreshAdmin();
    const enabled = await app!.inject({
      method: 'PUT',
      url: '/api/v1/admin/oauth-mcp-settings',
      headers: { cookie: adminCookie, origin: 'http://localhost:3100' },
      payload: {
        enabled: true,
        redirectUris: [REDIRECT],
        clientIdPrefixes: ['https://chatgpt.com/oauth/'],
        scopeCeiling: ['projects:read', 'knowledge:read', 'knowledge:write'],
      },
    });
    expect(enabled.statusCode).toBe(200);

    const { verifier, txn } = await authorize(
      'projects:read knowledge:read knowledge:write',
      adminCookie,
    );
    const consent = await app!.inject({
      method: 'POST',
      url: '/api/v1/oauth/consent',
      headers: { cookie: adminCookie, origin: 'http://localhost:3100' },
      payload: {
        txn,
        scopes: ['projects:read', 'knowledge:read', 'knowledge:write'],
        allowedWorkspaceIds: [workspaceId],
      },
    });
    expect(consent.statusCode).toBe(200);
    const code = new URL((consent.json() as { redirectTo: string }).redirectTo).searchParams.get(
      'code',
    )!;
    const token = await app!.inject({
      method: 'POST',
      url: '/oauth/token',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT,
        client_id: CLIENT_ID,
        code_verifier: verifier,
        resource: 'http://localhost:3100/mcp/oauth',
      }).toString(),
    });
    expect(token.statusCode).toBe(200);
    const access = (token.json() as { access_token: string }).access_token;
    const grants = await app!.inject({
      method: 'GET',
      url: '/api/v1/oauth/grants',
      headers: { cookie: adminCookie },
    });
    const grant = (
      grants.json() as { grants: Array<{ id: string; status: string; scopes: string[] }> }
    ).grants.find((row) => row.status === 'active' && row.scopes.includes('knowledge:write'));
    expect(grant?.id).toBeTruthy();

    async function hubTool(id: number, toolName: string, args: Record<string, unknown>) {
      const response = await app!.inject({
        method: 'POST',
        url: '/mcp/oauth',
        headers: {
          authorization: `Bearer ${access}`,
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
        },
        payload: {
          jsonrpc: '2.0',
          id,
          method: 'tools/call',
          params: {
            name: 'call_hub_tool',
            arguments: { toolName, arguments: args },
          },
        },
      });
      expect(response.statusCode).toBe(200);
      const result = (
        response.json() as { result?: { isError?: boolean; content?: Array<{ text?: string }> } }
      ).result;
      const text = result?.content?.[0]?.text ?? '';
      return {
        isError: Boolean(result?.isError),
        text,
        data: JSON.parse(text || '{}') as Record<string, unknown>,
      };
    }

    const described = await hubTool(1, 'describe_hub_tool', {
      name: 'begin_record_content_upload',
    });
    expect(described.isError, described.text).toBe(false);
    const beginSchema = described.data as {
      allowed: string[];
      required: string[];
    };
    expect(beginSchema.allowed).toContain('changeMessage');
    expect(beginSchema.required).toEqual(['recordId']);

    const created = await hubTool(2, 'create_knowledge_record', {
      workspaceId,
      title: 'OAuth draft',
      recordType: 'note',
      contentMarkdown: '# Grant\n',
    });
    expect(created.isError, created.text).toBe(false);
    const recordId = (created.data.knowledgeRecord as { id: string }).id;

    const beginArgs: Record<string, unknown> = {};
    if (beginSchema.required.includes('recordId')) beginArgs.recordId = recordId;
    if (beginSchema.allowed.includes('changeMessage')) beginArgs.changeMessage = 'from begin';
    const begun = await hubTool(3, 'begin_record_content_upload', beginArgs);
    expect(begun.isError, begun.text).toBe(false);
    const uploadId = begun.data.uploadId as string;

    const appendSchema = await hubTool(4, 'list_hub_tools', { name: 'append_record_content' });
    expect(appendSchema.isError, appendSchema.text).toBe(false);
    const appendFields = appendSchema.data as { allowed: string[]; required: string[] };
    expect(appendFields.allowed).not.toContain('contentMarkdown');
    const appendArgs: Record<string, unknown> = {};
    if (appendFields.required.includes('uploadId')) appendArgs.uploadId = uploadId;
    if (appendFields.required.includes('chunk')) appendArgs.chunk = '# Grant body\n';
    const appended = await hubTool(5, 'append_record_content', appendArgs);
    expect(appended.isError, appended.text).toBe(false);

    const finalizeSchema = await hubTool(6, 'describe_hub_tool', {
      name: 'finalize_record_content_upload',
    });
    const finalizeFields = finalizeSchema.data as { required: string[] };
    expect(finalizeFields.required).not.toContain('changeMessage');
    const finalizeArgs: Record<string, unknown> = { uploadId };
    const finalized = await hubTool(7, 'finalize_record_content_upload', finalizeArgs);
    expect(finalized.isError, finalized.text).toBe(false);

    const audits = await database!.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.entityId, recordId));
    expect(audits.some((event) => event.action === 'knowledge_record.create')).toBe(true);
    expect(audits.every((event) => event.actorType === 'oauth_grant')).toBe(true);
    expect(audits.every((event) => event.actorId === grant!.id)).toBe(true);
  });
});
