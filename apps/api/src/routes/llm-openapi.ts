import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '@project-knowledge-hub/domain';
import {
  buildLlmOpenApiDocument,
  hasMcpScope,
  MCP_RATE_LIMIT_PER_MINUTE,
  type McpClientContext,
  type McpScope,
  type McpToolHandlers,
} from '@project-knowledge-hub/mcp';
import {
  extractBearerToken,
  loadApiClientByBearerToken,
} from '../lib/api-clients.js';
import { createMcpToolHandlers } from '../lib/mcp-tools.js';
import { resolveMcpPublicUrl } from '../lib/mcp-public-url.js';
import { writeAuditEvent } from '../lib/identity.js';

const TOOL_NAMES = [
  'list_projects',
  'list_systems',
  'get_project',
  'get_system',
  'list_knowledge_records',
  'search_knowledge',
  'get_knowledge_record',
  'get_record_provenance',
  'list_record_metadata',
  'create_knowledge_record',
  'update_knowledge_record',
] as const;

type ToolName = (typeof TOOL_NAMES)[number];

const toolNameSchema = z.enum(TOOL_NAMES);

const scopeByTool: Record<ToolName, McpScope> = {
  list_projects: 'projects:read',
  list_systems: 'systems:read',
  get_project: 'projects:read',
  get_system: 'systems:read',
  list_knowledge_records: 'knowledge:read',
  search_knowledge: 'knowledge:search',
  get_knowledge_record: 'knowledge:read',
  get_record_provenance: 'provenance:read',
  list_record_metadata: 'knowledge:read',
  create_knowledge_record: 'knowledge:write',
  update_knowledge_record: 'knowledge:write',
};

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

async function invokeTool(
  handlers: McpToolHandlers,
  client: McpClientContext,
  toolName: ToolName,
  body: unknown,
): Promise<unknown> {
  const scope = scopeByTool[toolName];
  if (!hasMcpScope(client.scopes, scope)) {
    throw new AppError({
      code: 'FORBIDDEN',
      message: `Missing required scope: ${scope}`,
      statusCode: 403,
    });
  }

  const raw = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};

  switch (toolName) {
    case 'list_projects':
      return handlers.listProjects({
        workspaceId: typeof raw.workspaceId === 'string' ? raw.workspaceId : undefined,
        limit: typeof raw.limit === 'number' ? raw.limit : 50,
      });
    case 'list_systems':
      return handlers.listSystems({
        workspaceId: typeof raw.workspaceId === 'string' ? raw.workspaceId : undefined,
        projectId: typeof raw.projectId === 'string' ? raw.projectId : undefined,
        limit: typeof raw.limit === 'number' ? raw.limit : 50,
      });
    case 'get_project':
      if (typeof raw.projectId !== 'string') {
        throw new AppError({
          code: 'VALIDATION_ERROR',
          message: 'projectId is required',
          statusCode: 400,
        });
      }
      return handlers.getProject({ projectId: raw.projectId });
    case 'get_system':
      if (typeof raw.systemId !== 'string') {
        throw new AppError({
          code: 'VALIDATION_ERROR',
          message: 'systemId is required',
          statusCode: 400,
        });
      }
      return handlers.getSystem({ systemId: raw.systemId });
    case 'list_knowledge_records':
      if (typeof raw.workspaceId !== 'string') {
        throw new AppError({
          code: 'VALIDATION_ERROR',
          message: 'workspaceId is required',
          statusCode: 400,
        });
      }
      return handlers.listKnowledgeRecords({
        workspaceId: raw.workspaceId,
        projectId: typeof raw.projectId === 'string' ? raw.projectId : undefined,
        systemId: typeof raw.systemId === 'string' ? raw.systemId : undefined,
        limit: typeof raw.limit === 'number' ? raw.limit : 50,
      });
    case 'search_knowledge':
      if (typeof raw.workspaceId !== 'string' || typeof raw.query !== 'string') {
        throw new AppError({
          code: 'VALIDATION_ERROR',
          message: 'workspaceId and query are required',
          statusCode: 400,
        });
      }
      return handlers.searchKnowledge({
        workspaceId: raw.workspaceId,
        query: raw.query,
        projectIds: Array.isArray(raw.projectIds)
          ? raw.projectIds.filter((id): id is string => typeof id === 'string')
          : undefined,
        systemIds: Array.isArray(raw.systemIds)
          ? raw.systemIds.filter((id): id is string => typeof id === 'string')
          : undefined,
        recordTypes: Array.isArray(raw.recordTypes)
          ? raw.recordTypes.filter((id): id is string => typeof id === 'string')
          : undefined,
        statuses: Array.isArray(raw.statuses)
          ? raw.statuses.filter((id): id is string => typeof id === 'string')
          : undefined,
        limit: typeof raw.limit === 'number' ? raw.limit : 10,
      });
    case 'get_knowledge_record':
      if (typeof raw.recordId !== 'string') {
        throw new AppError({
          code: 'VALIDATION_ERROR',
          message: 'recordId is required',
          statusCode: 400,
        });
      }
      return handlers.getKnowledgeRecord({ recordId: raw.recordId });
    case 'get_record_provenance':
      if (typeof raw.recordId !== 'string') {
        throw new AppError({
          code: 'VALIDATION_ERROR',
          message: 'recordId is required',
          statusCode: 400,
        });
      }
      return handlers.getRecordProvenance({ recordId: raw.recordId });
    case 'list_record_metadata':
      return handlers.listRecordMetadata();
    case 'create_knowledge_record':
      if (
        typeof raw.workspaceId !== 'string' ||
        typeof raw.title !== 'string' ||
        typeof raw.recordType !== 'string' ||
        typeof raw.contentMarkdown !== 'string'
      ) {
        throw new AppError({
          code: 'VALIDATION_ERROR',
          message: 'workspaceId, title, recordType, and contentMarkdown are required',
          statusCode: 400,
        });
      }
      return handlers.createKnowledgeRecord({
        workspaceId: raw.workspaceId,
        title: raw.title,
        recordType: raw.recordType,
        contentMarkdown: raw.contentMarkdown,
        summary: typeof raw.summary === 'string' ? raw.summary : undefined,
        slug: typeof raw.slug === 'string' ? raw.slug : undefined,
        projectId: typeof raw.projectId === 'string' ? raw.projectId : undefined,
        systemId: typeof raw.systemId === 'string' ? raw.systemId : undefined,
        tags: Array.isArray(raw.tags)
          ? raw.tags.filter((tag): tag is string => typeof tag === 'string')
          : undefined,
        language: typeof raw.language === 'string' ? raw.language : undefined,
        generatedByModel:
          typeof raw.generatedByModel === 'string' ? raw.generatedByModel : undefined,
        sourceTitle: typeof raw.sourceTitle === 'string' ? raw.sourceTitle : undefined,
      });
    case 'update_knowledge_record':
      if (typeof raw.recordId !== 'string' || typeof raw.changeMessage !== 'string') {
        throw new AppError({
          code: 'VALIDATION_ERROR',
          message: 'recordId and changeMessage are required',
          statusCode: 400,
        });
      }
      return handlers.updateKnowledgeRecord({
        recordId: raw.recordId,
        changeMessage: raw.changeMessage,
        title: typeof raw.title === 'string' ? raw.title : undefined,
        summary:
          raw.summary === null
            ? null
            : typeof raw.summary === 'string'
              ? raw.summary
              : undefined,
        recordType: typeof raw.recordType === 'string' ? raw.recordType : undefined,
        contentMarkdown:
          typeof raw.contentMarkdown === 'string' ? raw.contentMarkdown : undefined,
        projectId:
          raw.projectId === null
            ? null
            : typeof raw.projectId === 'string'
              ? raw.projectId
              : undefined,
        systemId:
          raw.systemId === null
            ? null
            : typeof raw.systemId === 'string'
              ? raw.systemId
              : undefined,
        tags: Array.isArray(raw.tags)
          ? raw.tags.filter((tag): tag is string => typeof tag === 'string')
          : undefined,
        language:
          raw.language === null
            ? null
            : typeof raw.language === 'string'
              ? raw.language
              : undefined,
        generatedByModel:
          typeof raw.generatedByModel === 'string' ? raw.generatedByModel : undefined,
        sourceTitle: typeof raw.sourceTitle === 'string' ? raw.sourceTitle : undefined,
      });
    default: {
      const _exhaustive: never = toolName;
      throw new AppError({
        code: 'NOT_FOUND',
        message: `Unknown tool: ${_exhaustive}`,
        statusCode: 404,
      });
    }
  }
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
    const params = z.object({ toolName: toolNameSchema }).parse(request.params);
    const client = await requireApiClient(app, request.headers.authorization);
    const handlers = createMcpToolHandlers(app, client.context, request.ip);

    try {
      const result = await invokeTool(handlers, client.context, params.toolName, request.body);
      await writeAuditEvent(app.database, {
        organizationId: client.organizationId,
        actorType: 'api_client',
        actorId: client.id,
        action: 'llm.tool_call',
        entityType: 'llm_tool',
        entityId: params.toolName,
        metadata: { clientName: client.name, toolName: params.toolName, ok: true },
        ipAddress: request.ip,
      });
      return result;
    } catch (error) {
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
          message: error instanceof Error ? error.message : 'Tool failed',
        },
        ipAddress: request.ip,
      });
      throw error;
    }
  });
}
