const OAUTH_DISCOVERY_PATHS = new Set([
  '/.well-known/oauth-authorization-server',
  '/.well-known/oauth-protected-resource/mcp/oauth',
]);

const OAUTH_API_PATHS = new Set([
  '/oauth/authorize',
  '/oauth/token',
  '/oauth/userinfo',
  '/oauth/jwks',
]);

/** How the web proxy should treat a path before the login redirect. */
export function oauthProxyAction(
  pathname: string,
): 'discovery' | 'oauth-api' | 'json-404' | 'continue' {
  if (OAUTH_DISCOVERY_PATHS.has(pathname)) {
    return 'discovery';
  }
  if (OAUTH_API_PATHS.has(pathname)) {
    return 'oauth-api';
  }
  if (pathname.startsWith('/.well-known/')) {
    return 'json-404';
  }
  return 'continue';
}
