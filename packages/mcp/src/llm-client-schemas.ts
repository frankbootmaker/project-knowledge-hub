/**
 * Client connection schemas for MCP and OpenAPI-based LLM platforms.
 * Pure JSON/YAML builders — safe to import from web and API.
 */

import { RECORD_TYPES } from '@project-knowledge-hub/domain';

export type LlmSchemaOptions = {
  mcpUrl: string;
  token: string;
  /** When false, omit draft-write operations from OpenAPI / Gemini declarations. */
  includeWriteTools?: boolean;
  serverName?: string;
};

const DEFAULT_NAME = 'project-knowledge-hub';

export function apiBaseFromMcpUrl(mcpUrl: string): string {
  return new URL(mcpUrl).origin;
}

export function llmOpenApiUrlFromMcpUrl(mcpUrl: string): string {
  return `${apiBaseFromMcpUrl(mcpUrl)}/api/v1/llm/openapi.json`;
}

function uuidProp(description: string) {
  return { type: 'string', format: 'uuid', description };
}

function stringProp(description: string, opts?: { minLength?: number; maxLength?: number }) {
  return {
    type: 'string',
    description,
    ...(opts?.minLength != null ? { minLength: opts.minLength } : {}),
    ...(opts?.maxLength != null ? { maxLength: opts.maxLength } : {}),
  };
}

type ToolDef = {
  name: string;
  description: string;
  write?: boolean;
  body: Record<string, unknown>;
};

function toolDefinitions(includeWriteTools: boolean): ToolDef[] {
  const read: ToolDef[] = [
    {
      name: 'list_projects',
      description: 'List accessible projects in allowed workspaces',
      body: {
        type: 'object',
        properties: {
          workspaceId: uuidProp('Optional workspace filter'),
          limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Max results' },
        },
      },
    },
    {
      name: 'list_systems',
      description: 'List accessible systems in allowed workspaces',
      body: {
        type: 'object',
        properties: {
          workspaceId: uuidProp('Optional workspace filter'),
          projectId: uuidProp('Optional project filter'),
          limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Max results' },
        },
      },
    },
    {
      name: 'get_project',
      description: 'Get a project by id',
      body: {
        type: 'object',
        required: ['projectId'],
        properties: { projectId: uuidProp('Project id') },
      },
    },
    {
      name: 'get_system',
      description: 'Get a system by id',
      body: {
        type: 'object',
        required: ['systemId'],
        properties: { systemId: uuidProp('System id') },
      },
    },
    {
      name: 'list_knowledge_records',
      description: 'List knowledge records in a workspace (excludes archived by default)',
      body: {
        type: 'object',
        required: ['workspaceId'],
        properties: {
          workspaceId: uuidProp('Workspace id'),
          projectId: uuidProp('Optional project filter'),
          systemId: uuidProp('Optional system filter'),
          limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Max results' },
        },
      },
    },
    {
      name: 'search_knowledge',
      description:
        'Search knowledge records (full-text by default; optional hybrid when embeddings are enabled)',
      body: {
        type: 'object',
        required: ['workspaceId', 'query'],
        properties: {
          workspaceId: uuidProp('Workspace id'),
          query: stringProp('Search query', { minLength: 1, maxLength: 300 }),
          projectIds: {
            type: 'array',
            items: { type: 'string', format: 'uuid' },
            description: 'Optional project filters',
          },
          systemIds: {
            type: 'array',
            items: { type: 'string', format: 'uuid' },
            description: 'Optional system filters',
          },
          recordTypes: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional record type filters',
          },
          statuses: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional lifecycle status filters',
          },
          limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Max results' },
          mode: {
            type: 'string',
            enum: ['fts', 'hybrid'],
            description: 'fts (default) or hybrid when embeddings are enabled',
          },
        },
      },
    },
    {
      name: 'get_knowledge_record',
      description: 'Retrieve a knowledge record including truncated markdown content',
      body: {
        type: 'object',
        required: ['recordId'],
        properties: { recordId: uuidProp('Knowledge record id') },
      },
    },
    {
      name: 'get_record_provenance',
      description: 'Retrieve verification and source provenance for a knowledge record',
      body: {
        type: 'object',
        required: ['recordId'],
        properties: { recordId: uuidProp('Knowledge record id') },
      },
    },
    {
      name: 'list_record_metadata',
      description:
        'List knowledge record field guides, allowed recordType values, lifecycle/source-of-truth enums, and MCP write constraints. Call before create_knowledge_record.',
      body: {
        type: 'object',
        properties: {},
      },
    },
  ];

  const write: ToolDef[] = [
    {
      name: 'create_knowledge_record',
      description:
        'Create a draft knowledge record (requires knowledge:write; humans must verify/mark-current). Prefer list_record_metadata first to choose recordType.',
      write: true,
      body: {
        type: 'object',
        required: ['workspaceId', 'title', 'recordType', 'contentMarkdown'],
        properties: {
          workspaceId: uuidProp('Workspace id'),
          title: stringProp('Title', { minLength: 1, maxLength: 300 }),
          recordType: {
            type: 'string',
            enum: [...RECORD_TYPES],
            description:
              'Record type from list_record_metadata (planning types include business-idea, vision, plan, initiative, note)',
          },
          contentMarkdown: stringProp('Markdown body', { maxLength: 500_000 }),
          summary: stringProp('Optional summary', { maxLength: 1000 }),
          slug: stringProp('Optional slug', { minLength: 1, maxLength: 96 }),
          projectId: uuidProp('Optional project id'),
          systemId: uuidProp('Optional system id'),
          tags: {
            type: 'array',
            items: { type: 'string', minLength: 1, maxLength: 64 },
            maxItems: 30,
          },
          language: stringProp('Optional language code', { minLength: 2, maxLength: 16 }),
          generatedByModel: stringProp('Optional model name', { maxLength: 160 }),
          sourceTitle: stringProp('Optional source title', { maxLength: 300 }),
        },
      },
    },
    {
      name: 'update_knowledge_record',
      description: 'Update a knowledge record as draft (requires knowledge:write and a changeMessage)',
      write: true,
      body: {
        type: 'object',
        required: ['recordId', 'changeMessage'],
        properties: {
          recordId: uuidProp('Knowledge record id'),
          changeMessage: stringProp('Why this change was made', { minLength: 1, maxLength: 500 }),
          title: stringProp('Title', { minLength: 1, maxLength: 300 }),
          summary: { type: 'string', nullable: true, maxLength: 1000 },
          recordType: {
            type: 'string',
            enum: [...RECORD_TYPES],
            description: 'Record type from list_record_metadata',
          },
          contentMarkdown: stringProp('Markdown body', { maxLength: 500_000 }),
          projectId: { type: 'string', format: 'uuid', nullable: true },
          systemId: { type: 'string', format: 'uuid', nullable: true },
          tags: {
            type: 'array',
            items: { type: 'string', minLength: 1, maxLength: 64 },
            maxItems: 30,
          },
          language: { type: 'string', nullable: true, minLength: 2, maxLength: 16 },
          generatedByModel: stringProp('Optional model name', { maxLength: 160 }),
          sourceTitle: stringProp('Optional source title', { maxLength: 300 }),
        },
      },
    },
  ];

  return includeWriteTools ? [...read, ...write] : read;
}

/**
 * ChatGPT Actions rejects bare `{ type: object, additionalProperties: true }`
 * (object schemas must declare `properties`) and requires `components.schemas`
 * to be an object when components is present.
 */
const TOOL_RESULT_SCHEMA = {
  type: 'object',
  description:
    'JSON tool result. Shape varies by operation (lists, records, search hits, etc.).',
  properties: {
    items: {
      type: 'array',
      description: 'Present for list/search-style tools',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Entity id when present' },
          title: { type: 'string', description: 'Display title when present' },
        },
      },
    },
    record: {
      type: 'object',
      description: 'Present for single-record tools',
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        slug: { type: 'string' },
        contentMarkdown: { type: 'string' },
      },
    },
    total: {
      type: 'integer',
      description: 'Total count when the tool returns paging metadata',
    },
    message: {
      type: 'string',
      description: 'Human-readable status or error detail when present',
    },
  },
} as const;

/** OpenAPI 3.1 for ChatGPT Actions, OpenWebUI OpenAPI tools, and generic OpenAPI clients. */
export function buildLlmOpenApiDocument(options: LlmSchemaOptions): Record<string, unknown> {
  const includeWrite = options.includeWriteTools !== false;
  const tools = toolDefinitions(includeWrite);
  const apiBase = apiBaseFromMcpUrl(options.mcpUrl);
  const title = options.serverName ?? 'Project Knowledge Hub';

  const paths: Record<string, unknown> = {};
  for (const tool of tools) {
    paths[`/api/v1/llm/tools/${tool.name}`] = {
      post: {
        operationId: tool.name,
        summary: tool.description,
        description: tool.description,
        tags: [tool.write ? 'write' : 'read'],
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: tool.body,
            },
          },
        },
        responses: {
          '200': {
            description: 'Tool result JSON',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ToolResult' },
              },
            },
          },
          '401': { description: 'Missing or invalid bearer token' },
          '403': { description: 'Missing scope or workspace not allowed' },
        },
      },
    };
  }

  return {
    openapi: '3.1.0',
    info: {
      title,
      version: '0.1.0',
      description:
        'OpenAPI facade over Project Knowledge Hub knowledge tools for ChatGPT Actions, ' +
        'Gemini / OpenAPI clients, and OpenWebUI. Authenticate with the API client bearer token.',
    },
    servers: [{ url: apiBase }],
    components: {
      schemas: {
        ToolResult: TOOL_RESULT_SCHEMA,
      },
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'API token',
          description: 'API client token from Admin → LLM / MCP setup',
        },
      },
    },
    security: [{ bearerAuth: [] }],
    paths,
  };
}

/** Swagger 2.0 for Microsoft Copilot Studio / Power Platform custom MCP connector. */
export function buildCopilotMcpSwagger(options: LlmSchemaOptions): Record<string, unknown> {
  const mcp = new URL(options.mcpUrl);
  const host = mcp.port ? `${mcp.hostname}:${mcp.port}` : mcp.hostname;
  const path = mcp.pathname || '/mcp';
  const title = options.serverName ?? 'Project Knowledge Hub';

  return {
    swagger: '2.0',
    info: {
      title,
      description:
        'MCP Streamable HTTP connector for Microsoft Copilot Studio. ' +
        'Import as a custom connector OpenAPI file, then set API key auth on the Authorization header ' +
        '(value: Bearer <token>).',
      version: '1.0.0',
    },
    host,
    basePath: '/',
    schemes: [mcp.protocol.replace(':', '') || 'https'],
    securityDefinitions: {
      bearerAuth: {
        type: 'apiKey',
        name: 'Authorization',
        in: 'header',
        description: 'Use: Bearer <api-client-token>',
      },
    },
    security: [{ bearerAuth: [] }],
    paths: {
      [path]: {
        post: {
          summary: `${title} MCP`,
          description: 'Streamable MCP endpoint (initialize, tools/list, tools/call)',
          operationId: 'InvokeMCP',
          'x-ms-agentic-protocol': 'mcp-streamable-1.0',
          responses: {
            '200': { description: 'Success' },
          },
        },
      },
    },
  };
}

/** Cursor / Claude Desktop style MCP JSON. */
export function buildCursorMcpConfig(options: LlmSchemaOptions): Record<string, unknown> {
  const name = options.serverName ?? DEFAULT_NAME;
  return {
    mcpServers: {
      [name]: {
        url: options.mcpUrl,
        headers: {
          Authorization: `Bearer ${options.token}`,
        },
      },
    },
  };
}

/**
 * Antigravity CLI (`agy`) MCP config — stdio Bearer proxy.
 * Direct `serverUrl` + headers is unreliable; mcp-remote OAuth breaks on our hub.
 */
export function buildAntigravityMcpConfig(options: LlmSchemaOptions): Record<string, unknown> {
  const name = options.serverName ?? DEFAULT_NAME;
  return {
    mcpServers: {
      [name]: {
        command: 'node',
        args: [
          'C:\\\\Users\\\\YOUR_USER\\\\AppData\\\\Local\\\\Temp\\\\mcp-bearer-stdio-proxy.mjs',
        ],
        env: {
          MCP_URL: options.mcpUrl,
          MCP_TOKEN: options.token,
        },
      },
    },
  };
}

/** Human-readable Antigravity setup checklist (wizard copy pane). */
export function buildAntigravitySetupSteps(options: LlmSchemaOptions): string {
  return [
    'Antigravity CLI setup (Google AI Pro / free — not Gemini CLI)',
    '',
    'Context: As of 2026-06-18, Gemini CLI (`gemini`) stopped serving individual',
    'Google AI Pro/Ultra/free accounts. Use Antigravity CLI (`agy`) instead.',
    'Enterprise Gemini Code Assist licenses can still use Gemini CLI.',
    '',
    '1. Install Antigravity CLI',
    '   Windows PowerShell:',
    '     irm https://antigravity.google/cli/install.ps1 | iex',
    '   macOS/Linux:',
    '     curl -fsSL https://antigravity.google/cli/install.sh | bash',
    '   Then run: agy  (sign in with Google)',
    '',
    '2. Download the Knowledge Hub Bearer stdio proxy',
    '   File: scripts/mcp-bearer-stdio-proxy.mjs (from this repo)',
    '   PowerShell example:',
    '     Invoke-WebRequest -Uri "https://raw.githubusercontent.com/frankbootmaker/project-knowledge-hub/feature/m7-dokploy/scripts/mcp-bearer-stdio-proxy.mjs" -OutFile "$env:TEMP\\mcp-bearer-stdio-proxy.mjs"',
    '',
    '3. Write %USERPROFILE%\\.gemini\\config\\mcp_config.json',
    '   Paste the Antigravity MCP config from the wizard (next pane).',
    '   - Replace YOUR_USER path with the real proxy path',
    '   - MCP_TOKEN is the raw API token (no "Bearer " prefix)',
    `   - MCP_URL should stay: ${options.mcpUrl}`,
    '',
    '4. Fully quit agy, start again, run /mcp',
    '   Expect: project-knowledge-hub with list_projects, search_knowledge, …',
    '',
    'Avoid: gemini CLI on consumer accounts; mcp-remote (OAuth HTML errors);',
    'raw serverUrl+headers in Antigravity (Authorization often dropped).',
  ].join('\n');
}

/**
 * Claude Desktop / Claude Code MCP JSON (same Streamable HTTP + Bearer shape as Cursor).
 */
export function buildClaudeMcpConfig(options: LlmSchemaOptions): Record<string, unknown> {
  return buildCursorMcpConfig(options);
}

/** claude.ai custom connector hints (remote MCP; not OpenAPI Actions). */
export function buildClaudeAiConnectorMeta(options: LlmSchemaOptions): {
  name: string;
  remoteMcpUrl: string;
  authentication: string;
  authorizationHeader: string;
  where: string;
} {
  return {
    name: options.serverName ?? DEFAULT_NAME,
    remoteMcpUrl: options.mcpUrl,
    authentication: 'HTTP header Authorization Bearer (API client token)',
    authorizationHeader: `Bearer ${options.token}`,
    where: 'claude.ai → Settings → Connectors → Add custom connector (remote MCP)',
  };
}

/** Human-readable Claude setup (Desktop, Code CLI, and claude.ai chat). */
export function buildClaudeSetupSteps(options: LlmSchemaOptions): string {
  const name = options.serverName ?? DEFAULT_NAME;
  return [
    'Claude setup (Desktop, Claude Code, and claude.ai chat)',
    '',
    'Claude uses MCP everywhere — not ChatGPT-style OpenAPI Actions.',
    'Public HTTPS + Bearer token required (same hub token as Cursor / ChatGPT).',
    '',
    'A) Claude Desktop',
    '   Paste the MCP JSON from the wizard into claude_desktop_config.json',
    '   (macOS: ~/Library/Application Support/Claude/claude_desktop_config.json).',
    '   Restart Desktop; enable the server if prompted.',
    '',
    'B) Claude Code (CLI)',
    '   Option 1 — same MCP JSON in your Claude Code MCP settings / project config.',
    '   Option 2 — CLI (header syntax may vary by Claude Code version):',
    `     claude mcp add --transport http ${name} ${options.mcpUrl} \\`,
    `       --header "Authorization: Bearer YOUR_HUB_TOKEN"`,
    '   Then: claude  →  /mcp',
    '',
    'C) claude.ai chat (Custom connector)',
    '   1. Open Settings → Connectors (or Custom connectors).',
    '   2. Add a remote MCP connector.',
    `   3. Server URL: ${options.mcpUrl}`,
    '   4. Auth: Authorization header with Bearer <api-client-token>',
    '      (use the connector meta pane from this wizard).',
    '   5. Enable the connector for the chat / project; try a search prompt.',
    '',
    'Notes:',
    '- Remote connectors are reached from Anthropic cloud — /mcp must be public HTTPS.',
    '- If chat connector auth is flaky, Claude Code/Desktop with local MCP JSON is the reliable path.',
    '- Team/Enterprise: org owners may need to allow custom connectors first.',
  ].join('\n');
}

/** OpenWebUI native MCP (Streamable HTTP) connection snippet. */
export function buildOpenWebUiMcpConfig(options: LlmSchemaOptions): Record<string, unknown> {
  const name = options.serverName ?? DEFAULT_NAME;
  return {
    name,
    type: 'mcp',
    url: options.mcpUrl,
    headers: {
      Authorization: `Bearer ${options.token}`,
    },
  };
}

/** OpenWebUI OpenAPI external tools connection snippet. */
export function buildOpenWebUiOpenApiConfig(options: LlmSchemaOptions): Record<string, unknown> {
  const name = options.serverName ?? DEFAULT_NAME;
  return {
    name,
    type: 'openapi',
    url: llmOpenApiUrlFromMcpUrl(options.mcpUrl),
    headers: {
      Authorization: `Bearer ${options.token}`,
    },
  };
}

/**
 * Gemini API functionDeclarations (OpenAPI-subset parameter schemas).
 * Use with the Gemini API / Vertex function calling.
 * Consumer terminal agents: prefer Antigravity CLI (`agy`), not Gemini CLI.
 */
export function buildGeminiFunctionDeclarations(
  options: LlmSchemaOptions,
): Record<string, unknown> {
  const includeWrite = options.includeWriteTools !== false;
  const tools = toolDefinitions(includeWrite);

  return {
    functionDeclarations: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: sanitizeForGemini(tool.body),
    })),
  };
}

/** Gemini API / Vertex MCP-compatible remote server config (same shape as Cursor).
 * Enterprise Gemini CLI only — consumers should use Antigravity (`buildAntigravityMcpConfig`).
 */
export function buildGeminiMcpConfig(options: LlmSchemaOptions): Record<string, unknown> {
  return buildCursorMcpConfig(options);
}

/** ChatGPT Custom GPT Actions auth hint (not pasted into schema; shown in UI). */
export function buildChatGptActionsMeta(options: LlmSchemaOptions): {
  openApiUrl: string;
  authType: string;
  authHeader: string;
} {
  return {
    openApiUrl: llmOpenApiUrlFromMcpUrl(options.mcpUrl),
    authType: 'API Key (Bearer)',
    authHeader: `Bearer ${options.token}`,
  };
}

function sanitizeForGemini(schema: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'nullable' || key === 'additionalProperties' || key.startsWith('x-')) {
      continue;
    }
    if (key === 'format' && value === 'uuid') {
      // Gemini accepts string; keep description elsewhere
      continue;
    }
    if (Array.isArray(value)) {
      out[key] = value.map((item) =>
        item && typeof item === 'object' && !Array.isArray(item)
          ? sanitizeForGemini(item as Record<string, unknown>)
          : item,
      );
      continue;
    }
    if (value && typeof value === 'object') {
      out[key] = sanitizeForGemini(value as Record<string, unknown>);
      continue;
    }
    out[key] = value;
  }
  return out;
}

export function stringifySchema(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
