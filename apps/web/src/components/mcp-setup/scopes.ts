export const MCP_READ_SCOPES = [
  'projects:read',
  'systems:read',
  'knowledge:read',
  'knowledge:search',
  'provenance:read',
] as const;

export const MCP_WRITE_SCOPES = [...MCP_READ_SCOPES, 'knowledge:write'] as const;

/** Opt-in Project Delivery scopes (NF-018/020). */
export const MCP_PM_READ_SCOPES = ['pm:read'] as const;
export const MCP_PM_WRITE_SCOPES = ['pm:read', 'pm:write'] as const;

/** Opt-in catalogue mutations (systems create/update). */
export const MCP_CATALOGUE_WRITE_SCOPES = ['catalogue:write'] as const;

export function buildMcpSetupScopes(input: {
  mode: 'read' | 'write';
  includePm: boolean;
  includeCatalogue?: boolean;
}): string[] {
  const base = input.mode === 'write' ? [...MCP_WRITE_SCOPES] : [...MCP_READ_SCOPES];
  const withPm = input.includePm
    ? input.mode === 'write'
      ? [...base, ...MCP_PM_WRITE_SCOPES]
      : [...base, ...MCP_PM_READ_SCOPES]
    : base;
  if (input.mode === 'write' && input.includeCatalogue) {
    return [...withPm, ...MCP_CATALOGUE_WRITE_SCOPES];
  }
  return withPm;
}

export const MCP_SETUP_STEPS = [
  'preflight',
  'configure',
  'create',
  'test',
  'schema',
  'done',
] as const;

export type McpSetupStep = (typeof MCP_SETUP_STEPS)[number];
