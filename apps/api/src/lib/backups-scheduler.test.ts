import { describe, expect, it } from 'vitest';
import { isSchedulerHeartbeatFresh } from './backups.js';

describe('isSchedulerHeartbeatFresh', () => {
  it('is false when age is missing', () => {
    expect(isSchedulerHeartbeatFresh(null)).toBe(false);
  });

  it('is true within the default freshness window', () => {
    expect(isSchedulerHeartbeatFresh(0)).toBe(true);
    expect(isSchedulerHeartbeatFresh(299)).toBe(true);
  });

  it('is false when the heartbeat is too old', () => {
    expect(isSchedulerHeartbeatFresh(301)).toBe(false);
    expect(isSchedulerHeartbeatFresh(3600)).toBe(false);
  });
});
