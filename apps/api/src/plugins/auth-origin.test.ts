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

  it('allows https Origin when the rewrite forwarded proto is http', () => {
    const request = {
      headers: {
        'x-forwarded-host': 'knowhub-design.example.com',
        'x-forwarded-proto': 'http',
      },
    };
    expect(
      isAllowedRequestOrigin(env, request, 'https://knowhub-design.example.com'),
    ).toBe(true);
  });

  it('allows the origin stamped by Next middleware', () => {
    const request = {
      headers: { 'x-kh-web-origin': 'https://knowhub-design.example.com' },
    };
    expect(
      isAllowedRequestOrigin(env, request, 'https://knowhub-design.example.com'),
    ).toBe(true);
  });

  it('allows same-origin fetch metadata from the browser', () => {
    expect(
      isAllowedRequestOrigin(
        env,
        { headers: { 'sec-fetch-site': 'same-origin' } },
        'https://knowhub-design.example.com',
      ),
    ).toBe(true);
  });

  it('rejects a foreign browser origin', () => {
    expect(
      isAllowedRequestOrigin(env, { headers: {} }, 'https://evil.example'),
    ).toBe(false);
    expect(
      isAllowedRequestOrigin(
        env,
        { headers: { 'sec-fetch-site': 'cross-site' } },
        'https://evil.example',
      ),
    ).toBe(false);
  });
});
