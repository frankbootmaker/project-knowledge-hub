import { describe, it, expect } from 'vitest';
import { assertDateRange, effectiveDateRange } from './date-validation.js';
import { AppError } from './index.js';

describe('assertDateRange', () => {
  it('should pass when end date equals start date', () => {
    expect(() => {
      assertDateRange({
        start: '2026-11-01',
        end: '2026-11-01',
        startField: 'startDate',
        endField: 'endDate',
      });
    }).not.toThrow();
  });

  it('should pass when end date is after start date', () => {
    expect(() => {
      assertDateRange({
        start: '2026-11-01',
        end: '2026-11-30',
        startField: 'startDate',
        endField: 'endDate',
      });
    }).not.toThrow();
  });

  it('should throw INVALID_DATE_RANGE when end date is before start date', () => {
    expect(() => {
      assertDateRange({
        start: '2026-11-30',
        end: '2026-11-01',
        startField: 'startDate',
        endField: 'endDate',
      });
    }).toThrow(AppError);

    try {
      assertDateRange({
        start: '2026-11-30',
        end: '2026-11-01',
        startField: 'startDate',
        endField: 'endDate',
      });
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe('INVALID_DATE_RANGE');
      expect((err as AppError).statusCode).toBe(400);
      expect((err as AppError).message).toContain('endDate (2026-11-01)');
      expect((err as AppError).message).toContain('startDate (2026-11-30)');
    }
  });

  it('should include custom field names in error message', () => {
    try {
      assertDateRange({
        start: '2026-12-14',
        end: '2026-12-01',
        startField: 'assignmentStart',
        endField: 'assignmentEnd',
      });
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).message).toContain('assignmentEnd');
      expect((err as AppError).message).toContain('assignmentStart');
    }
  });

  it('should skip validation when start date is null', () => {
    expect(() => {
      assertDateRange({
        start: null,
        end: '2026-11-01',
        startField: 'startDate',
        endField: 'endDate',
      });
    }).not.toThrow();
  });

  it('should skip validation when end date is null', () => {
    expect(() => {
      assertDateRange({
        start: '2026-11-01',
        end: null,
        startField: 'startDate',
        endField: 'endDate',
      });
    }).not.toThrow();
  });

  it('should skip validation when start date is undefined', () => {
    expect(() => {
      assertDateRange({
        start: undefined,
        end: '2026-11-01',
        startField: 'startDate',
        endField: 'endDate',
      });
    }).not.toThrow();
  });

  it('should skip validation when end date is undefined', () => {
    expect(() => {
      assertDateRange({
        start: '2026-11-01',
        end: undefined,
        startField: 'startDate',
        endField: 'endDate',
      });
    }).not.toThrow();
  });

  it('should skip validation when both dates are null', () => {
    expect(() => {
      assertDateRange({
        start: null,
        end: null,
        startField: 'startDate',
        endField: 'endDate',
      });
    }).not.toThrow();
  });
});

describe('effectiveDateRange', () => {
  it('should use patch values when both are supplied', () => {
    const result = effectiveDateRange({
      stored: { start: '2026-01-01', end: '2026-12-31' },
      patch: { start: '2026-02-01', end: '2026-11-30' },
    });
    expect(result).toEqual({ start: '2026-02-01', end: '2026-11-30' });
  });

  it('should use stored start when only end is patched', () => {
    const result = effectiveDateRange({
      stored: { start: '2026-01-01', end: '2026-12-31' },
      patch: { end: '2026-11-30' },
    });
    expect(result).toEqual({ start: '2026-01-01', end: '2026-11-30' });
  });

  it('should use stored end when only start is patched', () => {
    const result = effectiveDateRange({
      stored: { start: '2026-01-01', end: '2026-12-31' },
      patch: { start: '2026-02-01' },
    });
    expect(result).toEqual({ start: '2026-02-01', end: '2026-12-31' });
  });

  it('should treat explicit null in patch as clearing the field', () => {
    const result = effectiveDateRange({
      stored: { start: '2026-01-01', end: '2026-12-31' },
      patch: { start: null },
    });
    expect(result).toEqual({ start: null, end: '2026-12-31' });
  });

  it('should handle stored nulls', () => {
    const result = effectiveDateRange({
      stored: { start: null, end: null },
      patch: { start: '2026-01-01' },
    });
    expect(result).toEqual({ start: '2026-01-01', end: null });
  });

  it('should distinguish between undefined (not supplied) and null (explicitly cleared)', () => {
    const result1 = effectiveDateRange({
      stored: { start: '2026-01-01', end: '2026-12-31' },
      patch: { start: undefined, end: null },
    });
    expect(result1).toEqual({ start: '2026-01-01', end: null });

    const result2 = effectiveDateRange({
      stored: { start: '2026-01-01', end: '2026-12-31' },
      patch: { start: null, end: undefined },
    });
    expect(result2).toEqual({ start: null, end: '2026-12-31' });
  });
});
