import { describe, expect, it } from 'vitest';
import { redactSensitiveQueryParams } from './redact-request-url.js';

describe('redactSensitiveQueryParams', () => {
  it('redacts code and state in query strings', () => {
    const url =
      '/oauth/callback?code=super-secret-code&state=client-state-value&iss=https%3A%2F%2Fhub.example';
    expect(redactSensitiveQueryParams(url)).toBe(
      '/oauth/callback?code=%5BRedacted%5D&state=%5BRedacted%5D&iss=https%3A%2F%2Fhub.example',
    );
  });

  it('leaves paths without query strings unchanged', () => {
    expect(redactSensitiveQueryParams('/oauth/authorize')).toBe('/oauth/authorize');
  });

  it('redacts case-insensitive param names', () => {
    expect(redactSensitiveQueryParams('/x?CODE=abc&STATE=def')).toBe(
      '/x?CODE=%5BRedacted%5D&STATE=%5BRedacted%5D',
    );
  });
});
