import { describe, expect, it } from 'vitest';
import {
  oidcStateRedisKey,
  parseOidcPendingState,
  serializeOidcPendingState,
} from './oidc-client.js';

describe('oidc-client state helpers', () => {
  it('round-trips pending PKCE state', () => {
    const pending = {
      codeVerifier: 'verifier-abc',
      redirectUri: 'http://localhost:3100/api/v1/auth/oidc/callback',
    };
    const raw = serializeOidcPendingState(pending);
    expect(parseOidcPendingState(raw)).toEqual(pending);
  });

  it('rejects malformed pending state', () => {
    expect(parseOidcPendingState('not-json')).toBeNull();
    expect(parseOidcPendingState('{}')).toBeNull();
    expect(
      parseOidcPendingState(JSON.stringify({ codeVerifier: 'x' })),
    ).toBeNull();
  });

  it('builds redis key with prefix', () => {
    expect(oidcStateRedisKey('abc')).toBe('oidc:state:abc');
  });
});
