import { describe, expect, it } from 'vitest';
import { AppError, parseProjectCurrency } from './index.js';

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
