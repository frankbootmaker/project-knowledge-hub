import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { hasMcpScope, type McpScope } from './scopes.js';
import { enforceResponseSize, MCP_MAX_LIST_LIMIT } from './limits.js';

export type McpClientContext = {
  id: string;
  name: string;
  organizationId: string;
  scopes: string[];
  allowedWorkspaceIds: string[];
  allowedProjectIds: string[];
  actingUserId: string | null;
};

export type McpToolHandlers = {
  listProjects: (input: { workspaceId?: string; limit: number }) => Promise<unknown>;
  listSystems: (input: {
    workspaceId?: string;
    projectId?: string;
    limit: number;
  }) => Promise<unknown>;
  getProject: (input: { projectId: string }) => Promise<unknown>;
  getSystem: (input: { systemId: string }) => Promise<unknown>;
  listKnowledgeRecords: (input: {
    workspaceId: string;
    projectId?: string;
    systemId?: string;
    limit: number;
  }) => Promise<unknown>;
  searchKnowledge: (input: {
    workspaceId: string;
    query: string;
    projectIds?: string[];
    systemIds?: string[];
    recordTypes?: string[];
    statuses?: string[];
    limit: number;
    mode?: 'fts' | 'hybrid';
  }) => Promise<unknown>;
  getKnowledgeRecord: (input: { recordId: string }) => Promise<unknown>;
  getRecordProvenance: (input: { recordId: string }) => Promise<unknown>;
  listRecordMetadata: () => Promise<unknown>;
  createKnowledgeRecord: (input: {
    workspaceId: string;
    title: string;
    recordType: string;
    contentMarkdown: string;
    summary?: string;
    slug?: string;
    projectId?: string;
    systemId?: string;
    tags?: string[];
    language?: string;
    generatedByModel?: string;
    sourceTitle?: string;
  }) => Promise<unknown>;
  updateKnowledgeRecord: (input: {
    recordId: string;
    changeMessage: string;
    title?: string;
    summary?: string | null;
    recordType?: string;
    contentMarkdown?: string;
    projectId?: string | null;
    systemId?: string | null;
    tags?: string[];
    language?: string | null;
    generatedByModel?: string;
    sourceTitle?: string;
  }) => Promise<unknown>;
  onToolCall?: (
    toolName: string,
    ok: boolean,
    context?: McpToolCallContext,
  ) => Promise<void>;
};

export type McpToolCallContext = {
  recordId?: string;
  projectId?: string;
  systemId?: string;
  workspaceId?: string;
};

function requireScope(client: McpClientContext, scope: McpScope): void {
  if (!hasMcpScope(client.scopes, scope)) {
    throw new Error(`Missing required scope: ${scope}`);
  }
}

function textResult(data: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(enforceResponseSize(data), null, 2),
      },
    ],
  };
}

function extractToolContext(data: unknown): McpToolCallContext {
  if (!data || typeof data !== 'object') {
    return {};
  }
  const root = data as Record<string, unknown>;
  const ctx: McpToolCallContext = {};

  const take = (obj: Record<string, unknown>) => {
    if (typeof obj.id === 'string') {
      if ('contentMarkdown' in obj || 'lifecycleStatus' in obj || 'recordType' in obj) {
        ctx.recordId = obj.id;
      } else if ('criticality' in obj || 'systemType' in obj) {
        ctx.systemId = obj.id;
      } else if ('businessDomain' in obj || 'slug' in obj) {
        // project-like
        if (!ctx.projectId && !ctx.systemId) {
          ctx.projectId = ctx.projectId ?? obj.id;
        }
      }
    }
    if (typeof obj.workspaceId === 'string') ctx.workspaceId = obj.workspaceId;
    if (typeof obj.projectId === 'string') ctx.projectId = obj.projectId;
    if (typeof obj.systemId === 'string') ctx.systemId = obj.systemId;
    if (typeof obj.recordId === 'string') ctx.recordId = obj.recordId;
  };

  take(root);
  for (const key of [
    'knowledgeRecord',
    'project',
    'system',
    'record',
  ] as const) {
    const nested = root[key];
    if (nested && typeof nested === 'object') {
      take(nested as Record<string, unknown>);
    }
  }
  return ctx;
}

export function createKnowledgeHubMcpServer(
  client: McpClientContext,
  handlers: McpToolHandlers,
): McpServer {
  const server = new McpServer({
    name: 'project-knowledge-hub',
    version: '0.1.0',
  });

  const wrap =
    (
      toolName: string,
      scope: McpScope,
      fn: () => Promise<unknown>,
      argContext?: McpToolCallContext,
    ) =>
    async () => {
      try {
        requireScope(client, scope);
        const data = await fn();
        await handlers.onToolCall?.(toolName, true, {
          ...argContext,
          ...extractToolContext(data),
        });
        return textResult(data);
      } catch (error) {
        await handlers.onToolCall?.(toolName, false, argContext);
        const message = error instanceof Error ? error.message : 'Tool failed';
        return {
          isError: true,
          content: [{ type: 'text' as const, text: message }],
        };
      }
    };

  server.tool(
    'list_projects',
    'List accessible projects in allowed workspaces',
    {
      workspaceId: z.string().uuid().optional(),
      limit: z.number().int().min(1).max(MCP_MAX_LIST_LIMIT).optional(),
    },
    async (args) =>
      wrap('list_projects', 'projects:read', () =>
        handlers.listProjects({
          workspaceId: args.workspaceId,
          limit: args.limit ?? MCP_MAX_LIST_LIMIT,
        }),
      )(),
  );

  server.tool(
    'list_systems',
    'List accessible systems in allowed workspaces',
    {
      workspaceId: z.string().uuid().optional(),
      projectId: z.string().uuid().optional(),
      limit: z.number().int().min(1).max(MCP_MAX_LIST_LIMIT).optional(),
    },
    async (args) =>
      wrap('list_systems', 'systems:read', () =>
        handlers.listSystems({
          workspaceId: args.workspaceId,
          projectId: args.projectId,
          limit: args.limit ?? MCP_MAX_LIST_LIMIT,
        }),
      )(),
  );

  server.tool(
    'get_project',
    'Get a project by id',
    { projectId: z.string().uuid() },
    async (args) =>
      wrap('get_project', 'projects:read', () => handlers.getProject(args), {
        projectId: args.projectId,
      })(),
  );

  server.tool(
    'get_system',
    'Get a system by id',
    { systemId: z.string().uuid() },
    async (args) =>
      wrap('get_system', 'systems:read', () => handlers.getSystem(args), {
        systemId: args.systemId,
      })(),
  );

  server.tool(
    'list_knowledge_records',
    'List knowledge records in a workspace (excludes archived by default)',
    {
      workspaceId: z.string().uuid(),
      projectId: z.string().uuid().optional(),
      systemId: z.string().uuid().optional(),
      limit: z.number().int().min(1).max(MCP_MAX_LIST_LIMIT).optional(),
    },
    async (args) =>
      wrap(
        'list_knowledge_records',
        'knowledge:read',
        () =>
          handlers.listKnowledgeRecords({
            ...args,
            limit: args.limit ?? MCP_MAX_LIST_LIMIT,
          }),
        {
          workspaceId: args.workspaceId,
          projectId: args.projectId,
          systemId: args.systemId,
        },
      )(),
  );

  server.tool(
    'search_knowledge',
    'Search knowledge records (full-text by default; optional hybrid when embeddings are enabled)',
    {
      workspaceId: z.string().uuid(),
      query: z.string().min(1).max(300),
      projectIds: z.array(z.string().uuid()).optional(),
      systemIds: z.array(z.string().uuid()).optional(),
      recordTypes: z.array(z.string()).optional(),
      statuses: z.array(z.string()).optional(),
      limit: z.number().int().min(1).max(MCP_MAX_LIST_LIMIT).optional(),
      mode: z.enum(['fts', 'hybrid']).optional(),
    },
    async (args) =>
      wrap('search_knowledge', 'knowledge:search', () =>
        handlers.searchKnowledge({
          ...args,
          limit: args.limit ?? 10,
          mode: args.mode,
        }),
      )(),
  );

  server.tool(
    'get_knowledge_record',
    'Retrieve a knowledge record including truncated markdown content',
    { recordId: z.string().uuid() },
    async (args) =>
      wrap(
        'get_knowledge_record',
        'knowledge:read',
        () => handlers.getKnowledgeRecord(args),
        { recordId: args.recordId },
      )(),
  );

  server.tool(
    'get_record_provenance',
    'Retrieve verification and source provenance for a knowledge record',
    { recordId: z.string().uuid() },
    async (args) =>
      wrap(
        'get_record_provenance',
        'provenance:read',
        () => handlers.getRecordProvenance(args),
        { recordId: args.recordId },
      )(),
  );

  server.tool(
    'list_record_metadata',
    'List knowledge record field guides, allowed recordType values, lifecycle/source-of-truth enums, and MCP write constraints. Call before create_knowledge_record.',
    {},
    async () =>
      wrap('list_record_metadata', 'knowledge:read', () => handlers.listRecordMetadata())(),
  );

  server.tool(
    'create_knowledge_record',
    'Create a draft knowledge record (requires knowledge:write; humans must verify/mark-current). Prefer list_record_metadata first to choose recordType.',
    {
      workspaceId: z.string().uuid(),
      title: z.string().min(1).max(300),
      recordType: z.string().min(1).max(64),
      contentMarkdown: z.string().max(500_000),
      summary: z.string().max(1000).optional(),
      slug: z.string().min(1).max(96).optional(),
      projectId: z.string().uuid().optional(),
      systemId: z.string().uuid().optional(),
      tags: z.array(z.string().min(1).max(64)).max(30).optional(),
      language: z.string().min(2).max(16).optional(),
      generatedByModel: z.string().max(160).optional(),
      sourceTitle: z.string().max(300).optional(),
    },
    async (args) =>
      wrap(
        'create_knowledge_record',
        'knowledge:write',
        () => handlers.createKnowledgeRecord(args),
        {
          workspaceId: args.workspaceId,
          projectId: args.projectId,
          systemId: args.systemId,
        },
      )(),
  );

  server.tool(
    'update_knowledge_record',
    'Update a knowledge record as draft (requires knowledge:write and a changeMessage)',
    {
      recordId: z.string().uuid(),
      changeMessage: z.string().min(1).max(500),
      title: z.string().min(1).max(300).optional(),
      summary: z.string().max(1000).nullable().optional(),
      recordType: z.string().min(1).max(64).optional(),
      contentMarkdown: z.string().max(500_000).optional(),
      projectId: z.string().uuid().nullable().optional(),
      systemId: z.string().uuid().nullable().optional(),
      tags: z.array(z.string().min(1).max(64)).max(30).optional(),
      language: z.string().min(2).max(16).nullable().optional(),
      generatedByModel: z.string().max(160).optional(),
      sourceTitle: z.string().max(300).optional(),
    },
    async (args) =>
      wrap('update_knowledge_record', 'knowledge:write', () =>
        handlers.updateKnowledgeRecord(args),
      )(),
  );

  return server;
}
