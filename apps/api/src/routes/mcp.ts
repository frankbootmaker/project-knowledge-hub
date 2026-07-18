import type { FastifyInstance } from 'fastify';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { AppError } from '@project-knowledge-hub/domain';
import {
  createKnowledgeHubMcpServer,
  MCP_RATE_LIMIT_PER_MINUTE,
} from '@project-knowledge-hub/mcp';
import {
  extractBearerToken,
  loadApiClientByBearerToken,
} from '../lib/api-clients.js';
import { createMcpToolHandlers } from '../lib/mcp-tools.js';
import { writeAuditEvent } from '../lib/identity.js';

async function enforceRateLimit(
  app: FastifyInstance,
  clientId: string,
): Promise<void> {
  const key = `mcp:rl:${clientId}`;
  const count = await app.redis.incr(key);
  if (count === 1) {
    await app.redis.expire(key, 60);
  }
  if (count > MCP_RATE_LIMIT_PER_MINUTE) {
    throw new AppError({
      code: 'RATE_LIMITED',
      message: `MCP rate limit exceeded (${MCP_RATE_LIMIT_PER_MINUTE}/minute)`,
      statusCode: 429,
    });
  }
}

export async function registerMcpRoutes(app: FastifyInstance): Promise<void> {
  app.route({
    method: ['GET', 'POST', 'DELETE'],
    url: '/mcp',
    handler: async (request, reply) => {
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

      await enforceRateLimit(app, client.id);

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });

      const handlers = createMcpToolHandlers(app, client.context, request.ip);
      const server = createKnowledgeHubMcpServer(client.context, handlers);
      await server.connect(transport);

      await writeAuditEvent(app.database, {
        organizationId: client.organizationId,
        actorType: 'api_client',
        actorId: client.id,
        action: 'mcp.request',
        entityType: 'mcp',
        entityId: client.id,
        metadata: { method: request.method, clientName: client.name },
        ipAddress: request.ip,
      });

      reply.hijack();
      try {
        await transport.handleRequest(request.raw, reply.raw, request.body);
      } finally {
        await server.close().catch(() => undefined);
      }
    },
  });
}
