import { describe, expect, it } from 'vitest';
import { detectContentSecrets, hasHighSeverityWarnings } from './secrets.js';

describe('detectContentSecrets', () => {
  it('flags OpenAI-style keys without returning the secret', () => {
    const warnings = detectContentSecrets('token sk-abcdefghijklmnopqrstuvwxyz012345');
    expect(warnings.some((w) => w.code === 'openai_sk')).toBe(true);
    expect(JSON.stringify(warnings)).not.toContain('sk-abcdefghijklmnopqrstuvwxyz012345');
  });

  it('flags PEM private keys as high severity', () => {
    const warnings = detectContentSecrets(
      'here\n-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----',
    );
    expect(hasHighSeverityWarnings(warnings)).toBe(true);
    expect(warnings[0]?.code).toBe('private_key_pem');
  });

  it('returns empty for clean notes', () => {
    expect(detectContentSecrets('Ship the importer next week.')).toEqual([]);
  });
});
