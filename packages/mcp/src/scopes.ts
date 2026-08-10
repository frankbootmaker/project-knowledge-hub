export const MCP_SCOPES = [
  'projects:read',
  'systems:read',
  'knowledge:read',
  'knowledge:search',
  'provenance:read',
  'knowledge:write',
  /** Project Delivery milestones/tasks/RACI (NF-018). Opt-in; not in DEFAULT_MCP_SCOPES. */
  'pm:read',
  'pm:write',
  /** Redacted platform health / backup ages (NF-014). Opt-in; not in DEFAULT_MCP_SCOPES. */
  'monitoring:read',
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
