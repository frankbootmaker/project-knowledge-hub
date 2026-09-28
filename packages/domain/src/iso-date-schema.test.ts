import { describe, test, expect } from 'vitest';
import { isoDateSchema, isoDateNullableSchema } from './index.js';

describe('isoDateSchema', () => {
  test('accepts valid dates', () => {
    expect(isoDateSchema.safeParse('2026-01-15').success).toBe(true);
    expect(isoDateSchema.safeParse('2026-12-31').success).toBe(true);
    expect(isoDateSchema.safeParse('2024-02-29').success).toBe(true); // leap year
    expect(isoDateSchema.safeParse('2028-02-29').success).toBe(true); // leap year
  });

  test('rejects null for non-nullable schema', () => {
    expect(isoDateSchema.safeParse(null).success).toBe(false);
  });

  test('accepts null for nullable schema', () => {
    expect(isoDateNullableSchema.safeParse(null).success).toBe(true);
    expect(isoDateNullableSchema.safeParse('2026-01-15').success).toBe(true);
  });

  test('rejects invalid calendar dates', () => {
    expect(isoDateSchema.safeParse('2026-02-30').success).toBe(false); // Feb doesn't have 30 days
    expect(isoDateSchema.safeParse('2027-02-29').success).toBe(false); // not a leap year
    expect(isoDateSchema.safeParse('2026-13-01').success).toBe(false); // month 13 doesn't exist
    expect(isoDateSchema.safeParse('2026-00-15').success).toBe(false); // month 0 doesn't exist
    expect(isoDateSchema.safeParse('2026-04-31').success).toBe(false); // April has 30 days
    expect(isoDateSchema.safeParse('2026-11-31').success).toBe(false); // November has 30 days
  });

  test('rejects invalid formats', () => {
    expect(isoDateSchema.safeParse('26-01-15').success).toBe(false); // wrong year format
    expect(isoDateSchema.safeParse('2026/01/15').success).toBe(false); // wrong separator
    expect(isoDateSchema.safeParse('2026-1-15').success).toBe(false); // missing leading zero
    expect(isoDateSchema.safeParse('2026-01-5').success).toBe(false); // missing leading zero
    expect(isoDateSchema.safeParse('15-01-2026').success).toBe(false); // wrong order
    expect(isoDateSchema.safeParse('not a date').success).toBe(false);
    expect(isoDateSchema.safeParse('').success).toBe(false);
  });

  test('preserves date value', () => {
    const result = isoDateSchema.safeParse('2026-06-15');
    if (result.success) {
      expect(result.data).toBe('2026-06-15');
    } else {
      throw new Error('Expected parse to succeed');
    }
  });

  test('provides clear error messages', () => {
    const formatError = isoDateSchema.safeParse('2026/01/15');
    if (!formatError.success) {
      expect(formatError.error.issues[0]?.message).toContain('YYYY-MM-DD');
    }

    const dateError = isoDateSchema.safeParse('2026-02-30');
    if (!dateError.success) {
      expect(dateError.error.issues[0]?.message).toContain('Invalid calendar date');
    }
  });
});
