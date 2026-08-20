import { describe, expect, it } from 'vitest';
import { parseBrand } from './brand';

describe('brand preference', () => {
  it('accepts department palettes', () => {
    expect(parseBrand('knowhub')).toBe('knowhub');
    expect(parseBrand('bootmaker')).toBe('bootmaker');
    expect(parseBrand('nethorizon')).toBe('nethorizon');
    expect(parseBrand('in3')).toBe('in3');
  });

  it('falls back to knowhub', () => {
    expect(parseBrand('other')).toBe('knowhub');
    expect(parseBrand(undefined)).toBe('knowhub');
  });
});
