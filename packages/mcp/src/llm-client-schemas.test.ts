import { describe, expect, it } from 'vitest';
import {
  apiBaseFromMcpUrl,
  buildCopilotMcpSwagger,
  buildCursorMcpConfig,
  buildGeminiFunctionDeclarations,
  buildLlmOpenApiDocument,
  llmOpenApiUrlFromMcpUrl,
} from './llm-client-schemas.js';

const opts = {
  mcpUrl: 'https://knowledge.example.com/mcp',
  token: 'kh_test_token',
};

describe('llm-client-schemas', () => {
  it('derives API base and OpenAPI URL from MCP URL', () => {
    expect(apiBaseFromMcpUrl(opts.mcpUrl)).toBe('https://knowledge.example.com');
    expect(llmOpenApiUrlFromMcpUrl(opts.mcpUrl)).toBe(
      'https://knowledge.example.com/api/v1/llm/openapi.json',
    );
  });

  it('builds OpenAPI with search tool and optional write tools', () => {
    const readOnly = buildLlmOpenApiDocument({ ...opts, includeWriteTools: false });
    const paths = readOnly.paths as Record<string, unknown>;
    expect(paths['/api/v1/llm/tools/search_knowledge']).toBeTruthy();
    expect(paths['/api/v1/llm/tools/create_knowledge_record']).toBeUndefined();

    const withWrite = buildLlmOpenApiDocument({ ...opts, includeWriteTools: true });
    const writePaths = withWrite.paths as Record<string, unknown>;
    expect(writePaths['/api/v1/llm/tools/create_knowledge_record']).toBeTruthy();
  });

  it('builds Copilot Studio MCP swagger with streamable protocol', () => {
    const swagger = buildCopilotMcpSwagger(opts);
    expect(swagger.swagger).toBe('2.0');
    expect(swagger.host).toBe('knowledge.example.com');
    const post = (swagger.paths as Record<string, { post: Record<string, unknown> }>)['/mcp']
      .post;
    expect(post['x-ms-agentic-protocol']).toBe('mcp-streamable-1.0');
  });

  it('builds Cursor MCP config with bearer header', () => {
    const config = buildCursorMcpConfig(opts);
    const server = (config.mcpServers as Record<string, { headers: { Authorization: string } }>)[
      'project-knowledge-hub'
    ];
    expect(server.headers.Authorization).toBe('Bearer kh_test_token');
  });

  it('builds Gemini function declarations without uuid format', () => {
    const gemini = buildGeminiFunctionDeclarations({ ...opts, includeWriteTools: false });
    const decls = gemini.functionDeclarations as Array<{
      name: string;
      parameters: { properties?: Record<string, { format?: string }> };
    }>;
    const search = decls.find((d) => d.name === 'search_knowledge');
    expect(search).toBeTruthy();
    expect(search?.parameters.properties?.workspaceId?.format).toBeUndefined();
  });
});
