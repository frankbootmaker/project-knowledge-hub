import type { FastifyInstance } from 'fastify';

export type McpTestStepId = 'initialize' | 'tools_list' | 'search_knowledge';

export type McpTestStep = {
  id: McpTestStepId;
  ok: boolean;
  skipped?: boolean;
  message: string;
  details?: unknown;
};

type JsonRpcResult = {
  result?: {
    serverInfo?: { name?: string; version?: string };
    tools?: Array<{ name: string; description?: string }>;
    content?: Array<{ type?: string; text?: string }>;
    isError?: boolean;
  };
  error?: { code?: number; message?: string };
};

async function mcpJsonRpc(
  mcpUrl: string,
  token: string,
  id: number,
  method: string,
  params: Record<string, unknown>,
): Promise<{ statusCode: number; body: JsonRpcResult }> {
  const response = await fetch(mcpUrl, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      params,
    }),
  });

  let body: JsonRpcResult = {};
  try {
    body = (await response.json()) as JsonRpcResult;
  } catch {
    body = { error: { message: 'Non-JSON MCP response' } };
  }

  return { statusCode: response.status, body };
}

export async function runMcpConnectionTest(
  app: FastifyInstance,
  input: {
    token: string;
    workspaceId?: string;
    runSearch?: boolean;
  },
): Promise<{ ok: boolean; steps: McpTestStep[]; toolNames: string[] }> {
  const steps: McpTestStep[] = [];
  let toolNames: string[] = [];
  const mcpUrl = `${app.env.API_URL.replace(/\/$/, '')}/mcp`;

  const initResponse = await mcpJsonRpc(mcpUrl, input.token, 1, 'initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'kh-mcp-setup-wizard', version: '0.1.0' },
  });
  const serverName = initResponse.body.result?.serverInfo?.name;
  const initOk =
    initResponse.statusCode === 200 &&
    !initResponse.body.error &&
    Boolean(serverName);
  steps.push({
    id: 'initialize',
    ok: initOk,
    message: initOk
      ? `MCP initialize succeeded (${serverName})`
      : initResponse.body.error?.message ??
        `MCP initialize failed (HTTP ${initResponse.statusCode})`,
    details: initOk
      ? { serverInfo: initResponse.body.result?.serverInfo }
      : { statusCode: initResponse.statusCode, body: initResponse.body },
  });

  if (!initOk) {
    return { ok: false, steps, toolNames };
  }

  const toolsResponse = await mcpJsonRpc(mcpUrl, input.token, 2, 'tools/list', {});
  toolNames = (toolsResponse.body.result?.tools ?? []).map((tool) => tool.name);
  const expected = ['list_projects', 'search_knowledge', 'get_knowledge_record'];
  const missing = expected.filter((name) => !toolNames.includes(name));
  const toolsOk =
    toolsResponse.statusCode === 200 &&
    !toolsResponse.body.error &&
    missing.length === 0;
  steps.push({
    id: 'tools_list',
    ok: toolsOk,
    message: toolsOk
      ? `Listed ${toolNames.length} tools`
      : missing.length > 0
        ? `Missing expected tools: ${missing.join(', ')}`
        : toolsResponse.body.error?.message ??
          `tools/list failed (HTTP ${toolsResponse.statusCode})`,
    details: { toolNames, missing },
  });

  if (!toolsOk) {
    return { ok: false, steps, toolNames };
  }

  if (!input.runSearch || !input.workspaceId) {
    steps.push({
      id: 'search_knowledge',
      ok: true,
      skipped: true,
      message: input.workspaceId
        ? 'Search test skipped'
        : 'Search test skipped (no workspace selected)',
    });
    return { ok: true, steps, toolNames };
  }

  const searchResponse = await mcpJsonRpc(mcpUrl, input.token, 3, 'tools/call', {
    name: 'search_knowledge',
    arguments: {
      workspaceId: input.workspaceId,
      query: 'knowledge',
      limit: 3,
    },
  });
  const searchOk =
    searchResponse.statusCode === 200 &&
    !searchResponse.body.error &&
    searchResponse.body.result?.isError !== true;
  steps.push({
    id: 'search_knowledge',
    ok: searchOk,
    message: searchOk
      ? 'search_knowledge tool call succeeded'
      : searchResponse.body.error?.message ??
        searchResponse.body.result?.content?.[0]?.text ??
        `search_knowledge failed (HTTP ${searchResponse.statusCode})`,
    details: searchOk
      ? { preview: searchResponse.body.result?.content?.[0]?.text?.slice(0, 240) }
      : { statusCode: searchResponse.statusCode, body: searchResponse.body },
  });

  return {
    ok: steps.every((step) => step.ok),
    steps,
    toolNames,
  };
}
