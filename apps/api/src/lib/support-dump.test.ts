import { describe, expect, it } from 'vitest';
import { isBackupStale } from './monitoring.js';

describe('support dump helpers', () => {
  it('treats missing last-success as stale', () => {
    expect(isBackupStale(null, 36)).toBe(true);
  });

  it('flags ages beyond threshold', () => {
    expect(isBackupStale(35 * 3600, 36)).toBe(false);
    expect(isBackupStale(37 * 3600, 36)).toBe(true);
  });
});
