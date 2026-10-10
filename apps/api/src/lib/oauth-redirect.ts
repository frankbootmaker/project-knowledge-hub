/**
 * RFC 8252 §7.3: a native client may register a loopback redirect without a
 * port, then request the same URI on an ephemeral port. Scheme, host, path,
 * and the remaining URI components stay exact.
 */

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

export const NATIVE_LOOPBACK_REDIRECT = 'http://127.0.0.1/callback';

export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return LOOPBACK_HOSTS.has(host);
}

export function isLoopbackRedirectUri(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' && isLoopbackHost(url.hostname);
  } catch {
    return false;
  }
}

/** True when both URIs are the same, or both are loopback and differ only by port. */
export function oauthRedirectMatches(requested: string, registered: string): boolean {
  if (requested === registered) {
    return true;
  }
  let req: URL;
  let reg: URL;
  try {
    req = new URL(requested);
    reg = new URL(registered);
  } catch {
    return false;
  }
  if (!isLoopbackHost(req.hostname) || !isLoopbackHost(reg.hostname)) {
    return false;
  }
  return (
    req.protocol === reg.protocol
    && req.hostname.toLowerCase() === reg.hostname.toLowerCase()
    && req.pathname === reg.pathname
    && req.search === reg.search
    && req.username === reg.username
    && req.password === reg.password
    && req.hash === reg.hash
  );
}

export function redirectAllowed(redirectUri: string, allow: string[]): boolean {
  return allow.some((entry) => {
    if (!isLoopbackRedirectUri(entry) && entry.endsWith('/')) {
      return redirectUri.startsWith(entry);
    }
    return oauthRedirectMatches(redirectUri, entry);
  });
}

export function publishedRedirectMatches(
  redirectUri: string,
  published: string[] | undefined,
): boolean {
  return Boolean(published?.some((entry) => oauthRedirectMatches(redirectUri, entry)));
}

/** Keep the Codex loopback callback on the allowlist across older saved settings. */
export function withNativeLoopbackRedirect(redirectUris: string[]): string[] {
  if (redirectUris.some((entry) => oauthRedirectMatches(NATIVE_LOOPBACK_REDIRECT, entry))) {
    return redirectUris;
  }
  return [...redirectUris, NATIVE_LOOPBACK_REDIRECT];
}
