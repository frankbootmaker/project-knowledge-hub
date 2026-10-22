import { describe, expect, it } from 'vitest';
import { KEY_PREFIX_PATTERN } from '@project-knowledge-hub/domain';
import { uniqueIntegrationKeyPrefix } from './unique-key-prefix.js';

describe('uniqueIntegrationKeyPrefix', () => {
  it('returns valid AAA prefixes', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const prefix = uniqueIntegrationKeyPrefix();
      expect(KEY_PREFIX_PATTERN.test(prefix)).toBe(true);
      expect(prefix).toHaveLength(3);
      seen.add(prefix);
    }
    expect(seen.size).toBeGreaterThan(150);
  });
});
