import { describe, expect, it } from 'vitest';
import {
  isBackupStale,
  shouldAlertBackupFail,
  shouldAlertDiskLow,
} from './ops-alerts.js';

describe('ops alert helpers', () => {
  it('detects stale backups', () => {
    expect(isBackupStale(null, 36)).toBe(true);
    expect(isBackupStale(35 * 3600, 36)).toBe(false);
    expect(isBackupStale(37 * 3600, 36)).toBe(true);
  });

  it('alerts backup fail only when failure is newer than success', () => {
    expect(
      shouldAlertBackupFail({
        lastSuccessAt: null,
        lastFailureAt: '2026-07-24T12:00:00.000Z',
      }),
    ).toBe(true);
    expect(
      shouldAlertBackupFail({
        lastSuccessAt: '2026-07-24T13:00:00.000Z',
        lastFailureAt: '2026-07-24T12:00:00.000Z',
      }),
    ).toBe(false);
    expect(
      shouldAlertBackupFail({
        lastSuccessAt: '2026-07-24T11:00:00.000Z',
        lastFailureAt: '2026-07-24T12:00:00.000Z',
      }),
    ).toBe(true);
    expect(
      shouldAlertBackupFail({
        lastSuccessAt: '2026-07-24T12:00:00.000Z',
        lastFailureAt: null,
      }),
    ).toBe(false);
  });

  it('detects low disk free ratio', () => {
    expect(
      shouldAlertDiskLow({
        freeBytes: 5,
        totalBytes: 100,
        minFreeRatio: 0.1,
      }),
    ).toBe(true);
    expect(
      shouldAlertDiskLow({
        freeBytes: 20,
        totalBytes: 100,
        minFreeRatio: 0.1,
      }),
    ).toBe(false);
    expect(
      shouldAlertDiskLow({
        freeBytes: 1,
        totalBytes: 100,
        minFreeRatio: 0,
      }),
    ).toBe(false);
  });
});
