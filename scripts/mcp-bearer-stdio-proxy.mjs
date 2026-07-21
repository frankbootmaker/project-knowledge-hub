#!/usr/bin/env node
/**
 * Stdio ↔ Streamable HTTP MCP proxy with static Bearer auth (no OAuth).
 *
 * Use with Antigravity CLI / clients that drop Authorization on remote URLs,
 * or that choke on mcp-remote's OAuth discovery.
 *
 * Usage (PowerShell):
 *   $env:MCP_URL = "https://knowhub-dev.in3.technology/mcp"
 *   $env:MCP_TOKEN = "kh_your_token"
 *   node scripts/mcp-bearer-stdio-proxy.mjs
 *
 * Antigravity mcp_config.json:
 *   {
 *     "mcpServers": {
 *       "project-knowledge-hub": {
 *         "command": "node",
 *         "args": ["C:\\\\path\\\\to\\\\mcp-bearer-stdio-proxy.mjs"],
 *         "env": {
 *           "MCP_URL": "https://knowhub-dev.in3.technology/mcp",
 *           "MCP_TOKEN": "kh_your_token"
 *         }
 *       }
 *     }
 *   }
 */

import readline from 'node:readline';

const MCP_URL = process.env.MCP_URL?.trim();
const MCP_TOKEN = process.env.MCP_TOKEN?.trim();
/** Prefer a protocol version our hub MCP server negotiates today. */
const FORCE_PROTOCOL = process.env.MCP_PROTOCOL_VERSION?.trim() || '2024-11-05';

if (!MCP_URL || !MCP_TOKEN) {
  console.error('[kh-mcp-proxy] MCP_URL and MCP_TOKEN are required');
  process.exit(1);
}

function log(...args) {
  console.error('[kh-mcp-proxy]', ...args);
}

function write(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function postRpc(message) {
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${MCP_TOKEN}`,
    },
    body: JSON.stringify(message),
  });

  const contentType = res.headers.get('content-type') ?? '';
  const text = await res.text();

  if (!res.ok) {
    log(`HTTP ${res.status}: ${text.slice(0, 240)}`);
    if (message.id === undefined) {
      return null;
    }
    return {
      jsonrpc: '2.0',
      id: message.id,
      error: {
        code: -32000,
        message: `Upstream HTTP ${res.status}`,
        data: text.slice(0, 500),
      },
    };
  }

  if (contentType.includes('text/event-stream')) {
    let last = null;
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith('data:')) {
        continue;
      }
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') {
        continue;
      }
      try {
        last = JSON.parse(payload);
      } catch {
        // ignore partial SSE chunks
      }
    }
    return last;
  }

  try {
    return JSON.parse(text);
  } catch {
    log(`Non-JSON upstream body: ${text.slice(0, 240)}`);
    if (message.id === undefined) {
      return null;
    }
    return {
      jsonrpc: '2.0',
      id: message.id,
      error: { code: -32700, message: 'Upstream returned non-JSON' },
    };
  }
}

function rewriteInitialize(message) {
  if (message.method !== 'initialize' || !message.params || typeof message.params !== 'object') {
    return message;
  }
  return {
    ...message,
    params: {
      ...message.params,
      protocolVersion: FORCE_PROTOCOL,
    },
  };
}

function localDiscover(message) {
  // Antigravity 1.x may send server/discover before initialize. Answer locally so
  // we never forward a non-standard method that leaves proxies with result=undefined.
  return {
    jsonrpc: '2.0',
    id: message.id,
    result: {
      protocolVersion: FORCE_PROTOCOL,
      capabilities: { tools: {} },
      serverInfo: {
        name: 'project-knowledge-hub',
        version: '0.1.0',
      },
    },
  };
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on('line', (line) => {
  void (async () => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    let message;
    try {
      message = JSON.parse(trimmed);
    } catch {
      log('Ignoring invalid JSON line');
      return;
    }

    try {
      if (message.method === 'server/discover') {
        if (message.id !== undefined) {
          write(localDiscover(message));
        }
        return;
      }

      if (typeof message.method === 'string' && message.method.startsWith('notifications/')) {
        await postRpc(rewriteInitialize(message));
        return;
      }

      const response = await postRpc(rewriteInitialize(message));
      if (response && message.id !== undefined) {
        write(response);
      }
    } catch (error) {
      log(error);
      if (message.id !== undefined) {
        write({
          jsonrpc: '2.0',
          id: message.id,
          error: {
            code: -32603,
            message: error instanceof Error ? error.message : 'proxy error',
          },
        });
      }
    }
  })();
});
