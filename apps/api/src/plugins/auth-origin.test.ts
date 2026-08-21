import { describe, expect, it } from 'vitest';
import { allowedOriginsForRequest, isAllowedRequestOrigin } from './auth.js';

const env = {
  WEB_URL: 'https://live.example.com',
  API_URL: 'http://nd-api:3101',
};

describe('allowedOriginsForRequest', () => {
  it('allows WEB_URL and the internal API rewrite origin', () => {
    const allowed = allowedOriginsForRequest(env, { headers: {} });
    expect(allowed.has('https://live.example.com')).toBe(true);
    expect(allowed.has('http://nd-api:3101')).toBe(true);
  });

  it('allows the public host Traefik/Next forwarded on this request', () => {
    const request = {
      headers: {
        'x-forwarded-host': 'knowhub-design.example.com',
        'x-forwarded-proto': 'https',
      },
    };
    expect(
      isAllowedRequestOrigin(env, request, 'https://knowhub-design.example.com'),
    ).toBe(true);
  });

  it('rejects a foreign browser origin', () => {
    expect(
      isAllowedRequestOrigin(env, { headers: {} }, 'https://evil.example'),
    ).toBe(false);
  });
});
