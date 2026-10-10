import { describe, expect, it } from 'vitest';
import { oauthProxyAction } from './oauth-discovery';

describe('oauth discovery proxy', () => {
  it('forwards only the path-scoped OAuth documents', () => {
    expect(oauthProxyAction('/.well-known/oauth-protected-resource/mcp/oauth')).toBe(
      'discovery',
    );
    expect(oauthProxyAction('/.well-known/oauth-authorization-server')).toBe('discovery');
    expect(oauthProxyAction('/.well-known/oauth-protected-resource')).toBe('json-404');
    expect(oauthProxyAction('/.well-known/oauth-protected-resource/mcp')).toBe('json-404');
    expect(oauthProxyAction('/oauth/authorize')).toBe('oauth-api');
    expect(oauthProxyAction('/mcp')).toBe('continue');
  });
});
