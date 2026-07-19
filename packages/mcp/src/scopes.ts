export const MCP_SCOPES = [
  'projects:read',
  'systems:read',
  'knowledge:read',
  'knowledge:search',
  'provenance:read',
  'knowledge:write',
] as const;

export type McpScope = (typeof MCP_SCOPES)[number];

/** Default scopes for new API clients — read/search only; write is opt-in. */
export const DEFAULT_MCP_SCOPES: McpScope[] = [
  'projects:read',
  'systems:read',
  'knowledge:read',
  'knowledge:search',
  'provenance:read',
];

export function hasMcpScope(scopes: string[], required: McpScope): boolean {
  return scopes.includes(required);
}
