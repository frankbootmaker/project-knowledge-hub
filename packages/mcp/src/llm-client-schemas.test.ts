import { describe, expect, it } from 'vitest';
import {
  apiBaseFromMcpUrl,
  buildAntigravityMcpConfig,
  buildAntigravitySetupSteps,
  buildClaudeAiConnectorMeta,
  buildClaudeMcpConfig,
  buildClaudeSetupSteps,
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
    expect(paths['/api/v1/llm/tools/list_record_metadata']).toBeTruthy();
    expect(paths['/api/v1/llm/tools/create_knowledge_record']).toBeUndefined();

    const withWrite = buildLlmOpenApiDocument({ ...opts, includeWriteTools: true });
    const writePaths = withWrite.paths as Record<string, unknown>;
    const createPath = writePaths['/api/v1/llm/tools/create_knowledge_record'] as {
      post: {
        requestBody: {
          content: {
            'application/json': {
              schema: { properties: { recordType: { enum?: string[] } } };
            };
          };
        };
      };
    };
    expect(createPath).toBeTruthy();
    expect(createPath.post.requestBody.content['application/json'].schema.properties.recordType.enum).toContain(
      'vision',
    );
  });

  it('satisfies ChatGPT Actions schema constraints', () => {
    const doc = buildLlmOpenApiDocument(opts);
    const components = doc.components as {
      schemas: { ToolResult: { type: string; properties: Record<string, unknown> } };
    };
    expect(components.schemas).toBeTypeOf('object');
    expect(components.schemas.ToolResult.type).toBe('object');
    expect(components.schemas.ToolResult.properties).toBeTruthy();

    const paths = doc.paths as Record<
      string,
      {
        post: {
          responses: {
            '200': {
              content: { 'application/json': { schema: { $ref?: string } } };
            };
          };
        };
      }
    >;
    for (const path of Object.values(paths)) {
      expect(path.post.responses['200'].content['application/json'].schema.$ref).toBe(
        '#/components/schemas/ToolResult',
      );
    }
  });

  it('builds Antigravity stdio proxy MCP config and setup steps', () => {
    const config = buildAntigravityMcpConfig(opts);
    const server = (
      config.mcpServers as Record<
        string,
        { command: string; env: { MCP_URL: string; MCP_TOKEN: string } }
      >
    )['project-knowledge-hub'];
    expect(server.command).toBe('node');
    expect(server.env.MCP_URL).toBe(opts.mcpUrl);
    expect(server.env.MCP_TOKEN).toBe(opts.token);

    const steps = buildAntigravitySetupSteps(opts);
    expect(steps).toContain('Antigravity CLI');
    expect(steps).toContain('mcp-bearer-stdio-proxy.mjs');
    expect(steps).toContain(opts.mcpUrl);
  });

  it('builds Claude MCP config and claude.ai connector meta', () => {
    const config = buildClaudeMcpConfig(opts);
    const server = (
      config.mcpServers as Record<string, { url: string; headers: { Authorization: string } }>
    )['project-knowledge-hub'];
    expect(server.url).toBe(opts.mcpUrl);
    expect(server.headers.Authorization).toBe(`Bearer ${opts.token}`);

    const connector = buildClaudeAiConnectorMeta(opts);
    expect(connector.remoteMcpUrl).toBe(opts.mcpUrl);
    expect(connector.authorizationHeader).toBe(`Bearer ${opts.token}`);

    const steps = buildClaudeSetupSteps(opts);
    expect(steps).toContain('claude.ai');
    expect(steps).toContain('Claude Code');
    expect(steps).toContain(opts.mcpUrl);
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
