import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireSystemAdmin } from '@project-knowledge-hub/permissions';
import { runMcpConnectionTest } from '../lib/mcp-connection-test.js';
import { getDefaultOrganization, writeAuditEvent } from '../lib/identity.js';
import {
  assertMutatingOrigin,
  requireAuthenticated,
} from '../plugins/auth.js';

export async function registerMcpSetupRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/mcp/setup/preflight', async (request) => {
    const principal = requireAuthenticated(request);
    requireSystemAdmin(principal);

    const [health, ready] = await Promise.all([
      app.inject({ method: 'GET', url: '/health' }),
      app.inject({ method: 'GET', url: '/ready' }),
    ]);

    const healthBody = health.json() as { status?: string };
    const readyBody = ready.json() as {
      status?: string;
      checks?: Record<string, string>;
    };

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
        mcpUrl: `${app.env.API_URL.replace(/\/$/, '')}/mcp`,
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
}
