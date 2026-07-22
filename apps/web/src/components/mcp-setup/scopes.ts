export const MCP_READ_SCOPES = [
  'projects:read',
  'systems:read',
  'knowledge:read',
  'knowledge:search',
  'provenance:read',
] as const;

export const MCP_WRITE_SCOPES = [...MCP_READ_SCOPES, 'knowledge:write'] as const;

export const MCP_SETUP_STEPS = [
  'preflight',
  'configure',
  'create',
  'test',
  'schema',
] as const;

export type McpSetupStep = (typeof MCP_SETUP_STEPS)[number];
