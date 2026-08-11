/**
 * Client connection schemas for MCP and OpenAPI-based LLM platforms.
 * Pure JSON/YAML builders — safe to import from web and API.
 */

import {
  toolDefinitionsForGemini,
  toolDefinitionsForOpenApi,
  type LlmToolDef,
} from './llm-tool-catalog.js';

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

export {
  LLM_TOOL_CATALOG,
  findLlmTool,
  listHubToolSummaries,
  toolDefinitionsForGemini,
  toolDefinitionsForOpenApi,
  toolNameToHandlerMethod,
  type LlmToolDef,
} from './llm-tool-catalog.js';


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

/** ChatGPT Actions rejects operation summary/description longer than 300. */
const CHATGPT_ACTIONS_TEXT_LIMIT = 300;

function forChatGptActionsText(text: string): string {
  if (text.length <= CHATGPT_ACTIONS_TEXT_LIMIT) {
    return text;
  }
  return `${text.slice(0, CHATGPT_ACTIONS_TEXT_LIMIT - 1)}…`;
}

/** OpenAPI 3.1 for ChatGPT Actions, OpenWebUI OpenAPI tools, and generic OpenAPI clients. */
export function buildLlmOpenApiDocument(options: LlmSchemaOptions): Record<string, unknown> {
  const includeWrite = options.includeWriteTools !== false;
  const tools: LlmToolDef[] = toolDefinitionsForOpenApi(includeWrite);
  const apiBase = apiBaseFromMcpUrl(options.mcpUrl);
  const title = options.serverName ?? 'Project Knowledge Hub';

  const paths: Record<string, unknown> = {};
  for (const tool of tools) {
    const actionText = forChatGptActionsText(tool.description);
    paths[`/api/v1/llm/tools/${tool.name}`] = {
      post: {
        operationId: tool.name,
        summary: actionText,
        description: actionText,
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
      // Bump when tool surface changes — ChatGPT Actions can cache schemas.
      version: '0.2.0',
      description: forChatGptActionsText(
        'Knowledge Hub OpenAPI (ChatGPT Actions). Bearer API token. ' +
          'Knowledge writes: knowledge:write. Catalogue systems: catalogue:write. ' +
          'Delivery tasks/sprints: pm:read/pm:write. ' +
          'Use create_project_task for delivery work (not knowledge notes). ' +
          'call_hub_tool reaches extended tools. Re-import after upgrades.',
      ),
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
          description: 'API client token from Account → AI connections or Admin MCP setup',
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
  const tools = toolDefinitionsForGemini(includeWrite);

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
