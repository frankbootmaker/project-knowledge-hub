import { describe, expect, it } from 'vitest';
import { DEFAULT_MCP_SCOPES, hasMcpScope } from './scopes.js';
import { truncateContent } from './limits.js';

describe('mcp scopes and limits', () => {
  it('includes default read scopes without write', () => {
    expect(DEFAULT_MCP_SCOPES).toContain('knowledge:search');
    expect(DEFAULT_MCP_SCOPES).not.toContain('knowledge:write');
    expect(DEFAULT_MCP_SCOPES).not.toContain('pm:read');
    expect(DEFAULT_MCP_SCOPES).not.toContain('pm:write');
    expect(DEFAULT_MCP_SCOPES).not.toContain('monitoring:read');
    expect(hasMcpScope(DEFAULT_MCP_SCOPES, 'projects:read')).toBe(true);
    expect(hasMcpScope(['projects:read'], 'knowledge:read')).toBe(false);
    expect(hasMcpScope(['monitoring:read'], 'monitoring:read')).toBe(true);
    expect(hasMcpScope(['knowledge:write'], 'knowledge:write')).toBe(true);
    expect(hasMcpScope(['pm:write'], 'pm:write')).toBe(true);
  });

  it('truncates oversized content', () => {
    const result = truncateContent('x'.repeat(10), 5);
    expect(result.truncated).toBe(true);
    expect(result.content.startsWith('xxxxx')).toBe(true);
  });
});
