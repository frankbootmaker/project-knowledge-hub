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

/** Opt-in operator snapshot (NF-014). Not part of the read or write bundles. */
export const MCP_MONITORING_READ_SCOPES = ['monitoring:read'] as const;

export function buildMcpSetupScopes(input: {
  mode: 'read' | 'write';
  includePm: boolean;
  includeCatalogue?: boolean;
  includeMonitoring?: boolean;
}): string[] {
  const base = input.mode === 'write' ? [...MCP_WRITE_SCOPES] : [...MCP_READ_SCOPES];
  const withPm = input.includePm
    ? input.mode === 'write'
      ? [...base, ...MCP_PM_WRITE_SCOPES]
      : [...base, ...MCP_PM_READ_SCOPES]
    : base;
  const withCatalogue =
    input.mode === 'write' && input.includeCatalogue
      ? [...withPm, ...MCP_CATALOGUE_WRITE_SCOPES]
      : withPm;
  if (!input.includeMonitoring) {
    return withCatalogue;
  }
  return [...withCatalogue, ...MCP_MONITORING_READ_SCOPES];
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
