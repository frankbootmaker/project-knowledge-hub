import { describe, expect, it } from 'vitest';
import { MemoryRateLimiter } from './rate-limit.js';

describe('MemoryRateLimiter', () => {
  it('allows up to max requests then blocks', () => {
    const limiter = new MemoryRateLimiter(2, 60_000);
    expect(limiter.allow('a')).toBe(true);
    expect(limiter.allow('a')).toBe(true);
    expect(limiter.allow('a')).toBe(false);
    expect(limiter.allow('b')).toBe(true);
  });
});
