import { describe, expect, it } from 'vitest';
import { AppError, parseProjectCurrency, parseReportingCurrency } from './index.js';

describe('parseProjectCurrency', () => {
  it('normalises lowercase ISO codes to uppercase', () => {
    expect(parseProjectCurrency('eur')).toBe('EUR');
    expect(parseProjectCurrency(' Usd ')).toBe('USD');
  });

  it('rejects unsupported codes with the allowed list', () => {
    for (const value of ['XYZ', 'ABC', '123']) {
      expect(() => parseProjectCurrency(value)).toThrow(AppError);
      try {
        parseProjectCurrency(value);
      } catch (error) {
        const appError = error as AppError;
        expect(appError.statusCode).toBe(400);
        expect(appError.code).toBe('VALIDATION_ERROR');
        expect(appError.message).toContain(`Invalid currency "${value}"`);
        expect(appError.message).toContain('EUR');
        expect(appError.message).toContain('JPY');
      }
    }
  });
});

describe('parseReportingCurrency (PRO-B-42)', () => {
  it('normalises usd to USD and keeps USD', () => {
    expect(parseReportingCurrency('usd')).toBe('USD');
    expect(parseReportingCurrency(' USD ')).toBe('USD');
    expect(parseReportingCurrency(undefined)).toBe('EUR');
  });

  it('rejects XXX and names reportingCurrency', () => {
    expect(() => parseReportingCurrency('XXX')).toThrow(AppError);
    try {
      parseReportingCurrency('XXX');
    } catch (error) {
      const appError = error as AppError;
      expect(appError.statusCode).toBe(400);
      expect(appError.code).toBe('VALIDATION_ERROR');
      expect(appError.message).toContain('reportingCurrency');
      expect(appError.message).toContain('XXX');
      expect(appError.message).toContain('USD');
      expect(appError.details).toEqual({ field: 'reportingCurrency' });
    }
  });
});
