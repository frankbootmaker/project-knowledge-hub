import type { FastifyInstance } from 'fastify';
import { AppError } from '@project-knowledge-hub/domain';
import { hasMcpScope, MCP_RATE_LIMIT_PER_MINUTE } from '@project-knowledge-hub/mcp';
import {
  extractBearerToken,
  loadApiClientByBearerToken,
} from '../lib/api-clients.js';
import { writeAuditEvent } from '../lib/identity.js';
import { buildSupportDump } from '../lib/support-dump.js';

async function enforceRateLimit(app: FastifyInstance, clientId: string): Promise<void> {
  const key = `mcp:rl:${clientId}`;
  const count = await app.redis.incr(key);
  if (count === 1) {
    await app.redis.expire(key, 60);
  }
  if (count > MCP_RATE_LIMIT_PER_MINUTE) {
    throw new AppError({
      code: 'RATE_LIMITED',
      message: `Platform status rate limit exceeded (${MCP_RATE_LIMIT_PER_MINUTE}/minute)`,
      statusCode: 429,
    });
  }
}

/**
 * NF-014 — redacted platform status for external monitors (Bearer API client).
 * Requires opt-in scope `monitoring:read` (not in DEFAULT_MCP_SCOPES).
 */
export async function registerPlatformStatusRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get('/api/v1/platform/status', async (request) => {
    const token = extractBearerToken(request.headers.authorization);
    if (!token) {
      throw new AppError({
        code: 'UNAUTHENTICATED',
        message: 'Bearer API token is required',
        statusCode: 401,
      });
    }

    const client = await loadApiClientByBearerToken(app.database, token);
    if (!client) {
      throw new AppError({
        code: 'UNAUTHENTICATED',
        message: 'Invalid or revoked API token',
        statusCode: 401,
      });
    }

    if (!hasMcpScope(client.context.scopes, 'monitoring:read')) {
      throw new AppError({
        code: 'FORBIDDEN',
        message: 'Missing required scope: monitoring:read',
        statusCode: 403,
      });
    }

    await enforceRateLimit(app, client.id);

    const dump = await buildSupportDump(app);
    await writeAuditEvent(app.database, {
      organizationId: client.context.organizationId,
      actorType: 'api_client',
      actorId: client.id,
      action: 'platform.status',
      entityType: 'monitoring',
      entityId: 'platform-status',
      metadata: { via: 'rest', byteLength: JSON.stringify(dump).length },
      ipAddress: request.ip,
    });

    return dump;
  });
}
