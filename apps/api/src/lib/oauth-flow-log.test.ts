import { describe, expect, it } from 'vitest';
import { secretHashPrefix, truncateUserAgent } from './oauth-flow-log.js';

describe('oauth flow log helpers', () => {
  it('truncates long user agents', () => {
    const ua = 'a'.repeat(150);
    expect(truncateUserAgent(ua)?.length).toBe(121);
    expect(truncateUserAgent('short')).toBe('short');
  });

  it('hashes secrets without returning the raw value', () => {
    const hash = secretHashPrefix('my-state-value');
    expect(hash).toHaveLength(12);
    expect(hash).not.toContain('my-state');
  });
});
