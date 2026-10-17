import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { normalizeObjectSchema } from '@modelcontextprotocol/sdk/server/zod-compat.js';
import { toJsonSchemaCompat } from '@modelcontextprotocol/sdk/server/zod-json-schema-compat.js';
import type { z } from 'zod';

const EMPTY_OBJECT_JSON_SCHEMA = {
  type: 'object',
  properties: {},
};

type RegisteredTool = {
  enabled?: boolean;
  title?: string;
  description?: string;
  inputSchema?: z.ZodTypeAny;
  outputSchema?: z.ZodRawShape | z.ZodTypeAny;
  annotations?: unknown;
  execution?: unknown;
  _meta?: Record<string, unknown>;
};

/**
 * Remove closed-object markers from tool output JSON Schema. Omitted
 * additionalProperties allows extra keys in draft-7 validators (AJV) without
 * emitting additionalProperties: true, which would bloat the OAuth tool list.
 */
export function relaxClosedJsonSchema(schema: unknown): unknown {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) {
    return schema.map((item) => relaxClosedJsonSchema(item));
  }
  const record = schema as Record<string, unknown>;
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (key === 'additionalProperties' && value === false) {
      continue;
    }
    next[key] = relaxClosedJsonSchema(value);
  }
  return next;
}

/** True when any object node in a JSON Schema sets additionalProperties: false. */
export function jsonSchemaHasClosedObjects(schema: unknown): boolean {
  const stack: unknown[] = [schema];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    if (Array.isArray(node)) {
      for (const item of node) stack.push(item);
      continue;
    }
    const record = node as Record<string, unknown>;
    if (record.additionalProperties === false) return true;
    for (const value of Object.values(record)) stack.push(value);
  }
  return false;
}

function toolListEntry(name: string, tool: RegisteredTool) {
  const toolDefinition: Record<string, unknown> = {
    name,
    title: tool.title,
    description: tool.description,
    inputSchema: (() => {
      const obj = normalizeObjectSchema(tool.inputSchema);
      return obj
        ? toJsonSchemaCompat(obj, {
          strictUnions: true,
          pipeStrategy: 'input',
        })
        : EMPTY_OBJECT_JSON_SCHEMA;
    })(),
    annotations: tool.annotations,
    execution: tool.execution,
    _meta: tool._meta,
  };
  if (tool.outputSchema) {
    const obj = normalizeObjectSchema(tool.outputSchema);
    if (obj) {
      toolDefinition.outputSchema = relaxClosedJsonSchema(
        toJsonSchemaCompat(obj, {
          strictUnions: true,
          pipeStrategy: 'output',
        }),
      );
    }
  }
  return toolDefinition;
}

/**
 * Advertise open output schemas on tools/list while keeping strict Zod output
 * shapes for server-side structuredContent validation and stripToSchema.
 */
export function openMcpToolOutputSchemas(server: McpServer): void {
  const mcp = server as unknown as {
    _registeredTools?: Record<string, RegisteredTool>;
    _toolHandlersInitialized?: boolean;
    server: { setRequestHandler: typeof server.server.setRequestHandler };
  };
  if (!mcp._registeredTools || !mcp._toolHandlersInitialized) return;

  mcp.server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: Object.entries(mcp._registeredTools!)
      .filter(([, tool]) => tool.enabled)
      .map(([name, tool]) => toolListEntry(name, tool)),
  }));
}
