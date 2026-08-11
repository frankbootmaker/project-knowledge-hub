import { describe, expect, it } from 'vitest';
import {
  normalizeCriticalityInput,
  parseItDetails,
} from './systems.js';

describe('systems IT details helpers', () => {
  it('parses itDetails and drops unknown keys', () => {
    const parsed = parseItDetails({
      hostname: 'db.internal',
      primaryUrl: 'https://db.example.com',
      vendor: 'PostgreSQL',
      junk: true,
    });
    expect(parsed).toEqual({
      hostname: 'db.internal',
      primaryUrl: 'https://db.example.com',
      vendor: 'PostgreSQL',
    });
  });

  it('normalizes criticality aliases', () => {
    expect(normalizeCriticalityInput('MEDIUM')).toBe('medium');
    expect(normalizeCriticalityInput(null)).toBeNull();
    expect(normalizeCriticalityInput(undefined)).toBeUndefined();
  });
});
