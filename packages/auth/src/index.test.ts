import { describe, expect, it } from 'vitest';
import {
  createSessionToken,
  hashPassword,
  hashSessionToken,
  SLUG_MAX_LENGTH,
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

  it('keeps a locale suffix on a max-length source slug', () => {
    const source = slugify(
      'OPE-DEP-1 Open Design on strix-halo-s1 Final Working Technical Configuration',
    );
    expect(source.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH);
    const translated = slugify(`${source}-de`);
    expect(translated.endsWith('-de')).toBe(true);
    expect(translated).not.toBe(source);
    expect(translated.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH);
  });
});
