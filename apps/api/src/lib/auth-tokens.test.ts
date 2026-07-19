import { describe, expect, it } from 'vitest';
import { createAuthToken, hashAuthToken } from '@project-knowledge-hub/auth';

describe('auth token hashing', () => {
  it('hashes tokens deterministically and differs from raw', () => {
    const token = createAuthToken();
    const hash = hashAuthToken(token);
    expect(hash).toHaveLength(64);
    expect(hash).not.toBe(token);
    expect(hashAuthToken(token)).toBe(hash);
  });
});
