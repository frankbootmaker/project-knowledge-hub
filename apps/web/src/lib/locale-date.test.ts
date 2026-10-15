import { describe, expect, it } from 'vitest';
import {
  formatLocaleDate,
  formatLocaleDateTime,
  formatStableDate,
  formatStableDateTime,
  isCalendarDate,
} from './locale-date';

describe('locale date formatter', () => {
  it('keeps a calendar day on that day', () => {
    expect(isCalendarDate('2026-07-01')).toBe(true);
    expect(formatStableDate('2026-07-01')).toBe('01/07/2026');
    expect(formatLocaleDate('2026-07-01', 'en-GB')).toBe('1 Jul 2026');
  });

  it('does not leave a raw ISO timestamp', () => {
    const value = '2026-10-14T18:30:00.000Z';
    expect(formatStableDateTime(value)).toBe('14/10/2026, 18:30:00');
    expect(formatLocaleDate(value, 'en-GB')).not.toContain('T');
    expect(formatLocaleDateTime(value, 'en-GB')).not.toContain('T');
  });

  it('returns unparseable values unchanged', () => {
    expect(formatLocaleDate('not-a-date', 'en')).toBe('not-a-date');
    expect(formatStableDate('not-a-date')).toBe('not-a-date');
  });
});
