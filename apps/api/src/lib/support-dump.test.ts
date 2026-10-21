import { describe, expect, it } from 'vitest';
import { isBackupStale, isOffsiteStale } from './monitoring.js';

describe('support dump helpers', () => {
  it('treats missing last-success as stale', () => {
    expect(isBackupStale(null, 36)).toBe(true);
  });

  it('flags ages beyond threshold', () => {
    expect(isBackupStale(35 * 3600, 36)).toBe(false);
    expect(isBackupStale(37 * 3600, 36)).toBe(true);
  });

  it('alerts when offsite is enabled and older than the threshold', () => {
    expect(isOffsiteStale(null, 48, false)).toBe(false);
    expect(isOffsiteStale(null, 48, true)).toBe(true);
    expect(isOffsiteStale(47 * 3600, 48, true)).toBe(false);
    expect(isOffsiteStale(49 * 3600, 48, true)).toBe(true);
  });
});
