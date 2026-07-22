import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '@project-knowledge-hub/domain';
import { requireSystemAdmin } from '@project-knowledge-hub/permissions';
import { runMcpConnectionTest } from '../lib/mcp-connection-test.js';
import {
  resolveMcpPublicUrl,
  setMcpPublicUrlOverride,
} from '../lib/mcp-public-url.js';
import { getDefaultOrganization, writeAuditEvent } from '../lib/identity.js';
import {
  assertMutatingOrigin,
  requireAuthenticated,
} from '../plugins/auth.js';

async function buildPreflightPayload(app: FastifyInstance) {
  const [health, ready] = await Promise.all([
    app.inject({ method: 'GET', url: '/health' }),
    app.inject({ method: 'GET', url: '/ready' }),
  ]);

  const healthBody = health.json() as { status?: string };
  const readyBody = ready.json() as {
    status?: string;
    checks?: Record<string, string>;
  };

  const urls = await resolveMcpPublicUrl(app.database, app.env);

  return {
    health: {
      ok: health.statusCode === 200 && healthBody.status === 'ok',
      statusCode: health.statusCode,
      body: healthBody,
    },
    ready: {
      ok: ready.statusCode === 200 && readyBody.status === 'ready',
      statusCode: ready.statusCode,
      body: readyBody,
    },
    endpoints: {
      apiUrl: app.env.API_URL,
      webUrl: app.env.WEB_URL,
      mcpUrl: urls.mcpUrl,
      mcpUrlInternal: urls.mcpUrlInternal,
      mcpUrlDefault: urls.mcpUrlDefault,
      mcpUrlOverride: urls.mcpUrlOverride,
      mcpUrlEnv: urls.mcpUrlEnv,
      mcpUrlSource: urls.source,
    },
  };
}

export async function registerMcpSetupRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/mcp/setup/preflight', async (request) => {
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);
    return buildPreflightPayload(app);
  });

  app.put('/api/v1/mcp/setup/public-url', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);
    const body = z
      .object({
        url: z.string().max(500).nullable(),
      })
      .parse(request.body);

    let saved: string | null = null;
    try {
      saved = await setMcpPublicUrlOverride(
        app.database,
        body.url,
        principal.userId,
      );
    } catch {
      throw new AppError({
        code: 'INVALID_MCP_PUBLIC_URL',
        message: 'Public MCP URL must be a valid absolute URL',
        statusCode: 400,
      });
    }

    const urls = await resolveMcpPublicUrl(app.database, app.env);
    const organization = await getDefaultOrganization(app.database);
    await writeAuditEvent(app.database, {
      organizationId: organization?.id ?? null,
      actorType: 'user',
      actorId: principal.userId,
      action: 'mcp.public_url_update',
      entityType: 'platform_settings',
      entityId: 'mcp_public_url',
      metadata: {
        override: saved,
        source: urls.source,
        mcpUrl: urls.mcpUrl,
      },
      ipAddress: request.ip,
    });

    return {
      endpoints: {
        apiUrl: app.env.API_URL,
        webUrl: app.env.WEB_URL,
        mcpUrl: urls.mcpUrl,
        mcpUrlInternal: urls.mcpUrlInternal,
        mcpUrlDefault: urls.mcpUrlDefault,
        mcpUrlOverride: urls.mcpUrlOverride,
        mcpUrlEnv: urls.mcpUrlEnv,
        mcpUrlSource: urls.source,
      },
    };
  });

  app.post('/api/v1/mcp/setup/test', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);
    const body = z
      .object({
        token: z.string().min(10).max(500),
        workspaceId: z.string().uuid().optional(),
        runSearch: z.boolean().optional(),
      })
      .parse(request.body);

    const result = await runMcpConnectionTest(app, {
      token: body.token,
      workspaceId: body.workspaceId,
      runSearch: body.runSearch ?? Boolean(body.workspaceId),
    });

    const organization = await getDefaultOrganization(app.database);
    await writeAuditEvent(app.database, {
      organizationId: organization?.id ?? null,
      actorType: 'user',
      actorId: principal.userId,
      action: 'mcp.connection_test',
      entityType: 'mcp',
      entityId: null,
      metadata: {
        ok: result.ok,
        steps: result.steps.map((step) => ({
          id: step.id,
          ok: step.ok,
          skipped: step.skipped ?? false,
        })),
        toolCount: result.toolNames.length,
      },
      ipAddress: request.ip,
    });

    return result;
  });

  // User-facing setup helpers (no public-url override)
  app.get('/api/v1/me/mcp/setup/preflight', async (request) => {
    requireAuthenticated(request);
    return buildPreflightPayload(app);
  });

  app.post('/api/v1/me/mcp/setup/test', async (request) => {
    assertMutatingOrigin(app, request);
    const principal = requireAuthenticated(request);
    const body = z
      .object({
        token: z.string().min(10).max(500),
        workspaceId: z.string().uuid().optional(),
        runSearch: z.boolean().optional(),
      })
      .parse(request.body);

    const result = await runMcpConnectionTest(app, {
      token: body.token,
      workspaceId: body.workspaceId,
      runSearch: body.runSearch ?? Boolean(body.workspaceId),
    });

    const organization = await getDefaultOrganization(app.database);
    await writeAuditEvent(app.database, {
      organizationId: organization?.id ?? null,
      actorType: 'user',
      actorId: principal.userId,
      action: 'mcp.connection_test',
      entityType: 'mcp',
      entityId: null,
      metadata: {
        ok: result.ok,
        by: 'self',
        steps: result.steps.map((step) => ({
          id: step.id,
          ok: step.ok,
          skipped: step.skipped ?? false,
        })),
        toolCount: result.toolNames.length,
      },
      ipAddress: request.ip,
    });

    return result;
  });
}
