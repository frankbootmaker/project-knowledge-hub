import { describe, expect, it } from 'vitest';
import {
  createSessionToken,
  hashPassword,
  hashSessionToken,
  slugify,
  verifyPassword,
} from './index.js';

describe('auth primitives', () => {
  it('hashes and verifies passwords', async () => {
    const hash = await hashPassword('correct-horse-battery');
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('correct-horse-battery', hash)).toBe(true);
    expect(await verifyPassword('wrong-password', hash)).toBe(false);
  });

  it('hashes session tokens deterministically', () => {
    const token = createSessionToken();
    expect(hashSessionToken(token)).toBe(hashSessionToken(token));
    expect(hashSessionToken(token)).not.toBe(token);
  });

  it('slugifies names', () => {
    expect(slugify('Home Infrastructure')).toBe('home-infrastructure');
  });
});
