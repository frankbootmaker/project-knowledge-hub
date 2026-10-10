import { describe, expect, it } from 'vitest';
import { buildMcpSetupScopes } from './scopes';

describe('buildMcpSetupScopes', () => {
  it('keeps monitoring:read off the read and write bundles', () => {
    expect(buildMcpSetupScopes({ mode: 'read', includePm: false })).not.toContain(
      'monitoring:read',
    );
    expect(
      buildMcpSetupScopes({
        mode: 'write',
        includePm: true,
        includeCatalogue: true,
      }),
    ).not.toContain('monitoring:read');
  });

  it('adds monitoring:read only when requested, in either mode', () => {
    expect(
      buildMcpSetupScopes({
        mode: 'read',
        includePm: false,
        includeMonitoring: true,
      }),
    ).toEqual([
      'projects:read',
      'systems:read',
      'knowledge:read',
      'knowledge:search',
      'provenance:read',
      'monitoring:read',
    ]);
    expect(
      buildMcpSetupScopes({
        mode: 'write',
        includePm: false,
        includeMonitoring: true,
      }),
    ).toContain('knowledge:write');
    expect(
      buildMcpSetupScopes({
        mode: 'write',
        includePm: false,
        includeMonitoring: true,
      }),
    ).toContain('monitoring:read');
  });
});
