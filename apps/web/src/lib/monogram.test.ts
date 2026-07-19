import { describe, expect, it } from 'vitest';
import { userMonogram } from './monogram.js';

describe('userMonogram', () => {
  it('uses initials from full name when present', () => {
    expect(userMonogram('ada', 'Ada Lovelace')).toBe('AL');
  });

  it('falls back to display name', () => {
    expect(userMonogram('Ada Lovelace')).toBe('AL');
    expect(userMonogram('Ada')).toBe('AD');
  });

  it('handles empty input', () => {
    expect(userMonogram('')).toBe('?');
  });
});
