export const MCP_SCOPES = [
  'projects:read',
  'systems:read',
  'knowledge:read',
  'knowledge:search',
  'provenance:read',
] as const;

export type McpScope = (typeof MCP_SCOPES)[number];

export const DEFAULT_MCP_SCOPES: McpScope[] = [...MCP_SCOPES];

export function hasMcpScope(scopes: string[], required: McpScope): boolean {
  return scopes.includes(required);
}
