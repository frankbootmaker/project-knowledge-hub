import { describe, expect, it } from 'vitest';
import { SLUG_MAX_LENGTH, slugify } from '@project-knowledge-hub/auth';
import { translationSlug } from './knowledge-records-service.js';

describe('translationSlug', () => {
  it('appends a locale suffix that survives a second slugify', () => {
    const source = slugify(
      'OPE-DEP-1 Open Design on strix-halo-s1 Final Working Technical Configuration',
    );
    const first = translationSlug(source, 'de');
    expect(first).not.toBe(source);
    expect(first.endsWith('-de')).toBe(true);
    expect(slugify(first)).toBe(first);
    expect(first.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH);
  });

  it('still unique when the stored source slug is already 64 chars', () => {
    const legacy = 'a'.repeat(64);
    const next = translationSlug(legacy, 'hu');
    expect(next).not.toBe(legacy);
    expect(next.endsWith('-hu')).toBe(true);
    expect(slugify(next)).toBe(next);
  });
});
