import type { FastifyInstance } from 'fastify';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { AppError } from '@project-knowledge-hub/domain';
import {
  createKnowledgeHubMcpServer,
  MCP_RATE_LIMIT_PER_MINUTE,
  oauthProtectedResourceMetadataUrl,
  oauthResourceUrlFromMcpUrl,
} from '@project-knowledge-hub/mcp';
import {
  extractBearerToken,
  loadApiClientByBearerToken,
} from '../lib/api-clients.js';
import { createMcpToolHandlers } from '../lib/mcp-tools.js';
import { writeAuditEvent } from '../lib/identity.js';
import { isOauthMcpEffectivelyEnabled, getStoredOauthMcpSettings } from '../lib/oauth-mcp-settings.js';
import { loadGrantFromAuthorization } from './oauth-mcp.js';
import { resolveMcpPublicUrl } from '../lib/mcp-public-url.js';

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

  app.route({
    method: ['GET', 'POST', 'DELETE'],
    url: '/mcp/oauth',
    handler: async (request, reply) => {
      const stored = await getStoredOauthMcpSettings(app.database);
      const resolved = await resolveMcpPublicUrl(app.database, app.env);
      const resourceUrl = oauthResourceUrlFromMcpUrl(resolved.mcpUrl);
      const metadataUrl = oauthProtectedResourceMetadataUrl(resourceUrl);
      reply.header('Access-Control-Expose-Headers', 'WWW-Authenticate');
      const challenge =
        `Bearer resource_metadata="${metadataUrl}", error="invalid_token", error_description="Authentication required"`;

      if (!isOauthMcpEffectivelyEnabled(stored, app.env)) {
        throw new AppError({
          code: 'OAUTH_MCP_DISABLED',
          message: 'OAuth MCP resource is disabled',
          statusCode: 403,
        });
      }

      const loaded = await loadGrantFromAuthorization(app, request.headers.authorization, {
        issuer: new URL(resourceUrl).origin,
        resourceUrl,
      });
      if (!loaded) {
        reply.header('WWW-Authenticate', challenge);
        throw new AppError({
          code: 'UNAUTHENTICATED',
          message: 'OAuth access token is required',
          statusCode: 401,
        });
      }

      await enforceRateLimit(app, loaded.id);

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      const handlers = createMcpToolHandlers(app, loaded.context, request.ip);
      const server = createKnowledgeHubMcpServer(loaded.context, handlers, {
        oauth: {
          resourceMetadataUrl: metadataUrl,
          profile: loaded.profile,
        },
      });
      await server.connect(transport);

      await writeAuditEvent(app.database, {
        organizationId: loaded.organizationId,
        actorType: 'oauth_grant',
        actorId: loaded.id,
        action: 'mcp.request',
        entityType: 'mcp',
        entityId: loaded.id,
        metadata: { method: request.method, via: 'chatgpt_oauth' },
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
