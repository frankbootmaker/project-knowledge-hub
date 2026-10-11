import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '@project-knowledge-hub/domain';
import {
  buildLlmOpenApiDocument,
  invokeNamedHubTool,
  LLM_TOOL_CATALOG,
  MCP_RATE_LIMIT_PER_MINUTE,
  type McpClientContext,
  type McpToolHandlers,
} from '@project-knowledge-hub/mcp';
import {
  extractBearerToken,
  loadApiClientByBearerToken,
} from '../lib/api-clients.js';
import { createMcpToolHandlers } from '../lib/mcp-tools.js';
import { resolveMcpPublicUrl } from '../lib/mcp-public-url.js';
import { writeAuditEvent } from '../lib/identity.js';

const TOOL_NAME_SET = new Set(LLM_TOOL_CATALOG.map((tool) => tool.name));
/** Native MCP-only tools still invokable via call_hub_tool / OpenAPI path. */
TOOL_NAME_SET.add('upload_workspace_media');

async function enforceRateLimit(app: FastifyInstance, clientId: string): Promise<void> {
  const key = `mcp:rl:${clientId}`;
  const count = await app.redis.incr(key);
  if (count === 1) {
    await app.redis.expire(key, 60);
  }
  if (count > MCP_RATE_LIMIT_PER_MINUTE) {
    throw new AppError({
      code: 'RATE_LIMITED',
      message: `LLM tools rate limit exceeded (${MCP_RATE_LIMIT_PER_MINUTE}/minute)`,
      statusCode: 429,
    });
  }
}

async function requireApiClient(app: FastifyInstance, authorization: string | undefined) {
  const token = extractBearerToken(authorization);
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
  return client;
}

function asArgs(body: unknown): Record<string, unknown> {
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    return { ...(body as Record<string, unknown>) };
  }
  return {};
}

async function invokeNamedTool(
  handlers: McpToolHandlers,
  client: McpClientContext,
  toolName: string,
  body: unknown,
  depth = 0,
): Promise<unknown> {
  return invokeNamedHubTool(handlers, client.scopes, toolName, body, depth);
}

export async function registerLlmOpenApiRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/llm/openapi.json', async () => {
    const resolved = await resolveMcpPublicUrl(app.database, app.env);
    return buildLlmOpenApiDocument({
      mcpUrl: resolved.mcpUrl,
      token: '',
      includeWriteTools: true,
    });
  });

  app.post('/api/v1/llm/tools/:toolName', async (request) => {
    const params = z
      .object({
        toolName: z.string().min(1).max(80),
      })
      .parse(request.params);

    if (!TOOL_NAME_SET.has(params.toolName)) {
      throw new AppError({
        code: 'NOT_FOUND',
        message: `Unknown tool: ${params.toolName}`,
        statusCode: 404,
      });
    }

    const client = await requireApiClient(app, request.headers.authorization);
    const handlers = createMcpToolHandlers(app, client.context, request.ip);

    try {
      const result = await invokeNamedTool(
        handlers,
        client.context,
        params.toolName,
        request.body,
      );
      const body = asArgs(request.body);
      await writeAuditEvent(app.database, {
        organizationId: client.organizationId,
        actorType: 'api_client',
        actorId: client.id,
        action: 'llm.tool_call',
        entityType: 'llm_tool',
        entityId: params.toolName,
        metadata: {
          clientName: client.name,
          toolName: params.toolName,
          ok: true,
          via: 'openapi',
          nestedTool:
            params.toolName === 'call_hub_tool' && typeof body.toolName === 'string'
              ? body.toolName
              : undefined,
          workspaceId: typeof body.workspaceId === 'string' ? body.workspaceId : undefined,
          recordId:
            typeof body.recordId === 'string'
              ? body.recordId
              : typeof body.knowledgeRecordId === 'string'
                ? body.knowledgeRecordId
                : undefined,
          projectId: typeof body.projectId === 'string' ? body.projectId : undefined,
          systemId: typeof body.systemId === 'string' ? body.systemId : undefined,
          taskId: typeof body.taskId === 'string' ? body.taskId : undefined,
          uploadId: typeof body.uploadId === 'string' ? body.uploadId : undefined,
          contentBase64Chars:
            typeof body.contentBase64 === 'string' ? body.contentBase64.length : undefined,
          chunkBase64Chars:
            typeof body.chunkBase64 === 'string' ? body.chunkBase64.length : undefined,
          chunkIndex: typeof body.index === 'number' ? body.index : undefined,
          contentType: typeof body.contentType === 'string' ? body.contentType : undefined,
          insertIntoRecord:
            typeof body.insertIntoRecord === 'boolean' ? body.insertIntoRecord : undefined,
        },
        ipAddress: request.ip,
      });
      return result;
    } catch (error) {
      const body = asArgs(request.body);
      await writeAuditEvent(app.database, {
        organizationId: client.organizationId,
        actorType: 'api_client',
        actorId: client.id,
        action: 'llm.tool_error',
        entityType: 'llm_tool',
        entityId: params.toolName,
        metadata: {
          clientName: client.name,
          toolName: params.toolName,
          ok: false,
          via: 'openapi',
          nestedTool:
            params.toolName === 'call_hub_tool' && typeof body.toolName === 'string'
              ? body.toolName
              : undefined,
          message: error instanceof Error ? error.message : 'unknown',
        },
        ipAddress: request.ip,
      });
      throw error;
    }
  });
}
