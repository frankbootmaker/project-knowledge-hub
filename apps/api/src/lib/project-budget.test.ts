import { describe, it, expect } from 'vitest';
import { parseBudgetAmount, parseHours, parseTokenRate } from './project-budget.js';

describe('parseBudgetAmount', () => {
  it('accepts numeric values', () => {
    expect(parseBudgetAmount(450000)).toBe(450000);
    expect(parseBudgetAmount(0)).toBe(0);
    expect(parseBudgetAmount(123.45)).toBe(123.45);
  });

  it('coerces string values to numbers', () => {
    expect(parseBudgetAmount('450000')).toBe(450000);
    expect(parseBudgetAmount('450000.00')).toBe(450000);
    expect(parseBudgetAmount('123.45')).toBe(123.45);
    expect(parseBudgetAmount('0')).toBe(0);
  });

  it('returns null for null input', () => {
    expect(parseBudgetAmount(null)).toBe(null);
  });

  it('returns null for empty string', () => {
    expect(parseBudgetAmount('')).toBe(null);
  });

  it('returns undefined for undefined input', () => {
    expect(parseBudgetAmount(undefined)).toBe(undefined);
  });

  it('rejects negative values', () => {
    expect(() => parseBudgetAmount(-100)).toThrow('Budget amount must be a non-negative number');
    expect(() => parseBudgetAmount('-100')).toThrow('Budget amount must be a non-negative number');
  });

  it('rejects invalid strings', () => {
    expect(() => parseBudgetAmount('invalid')).toThrow('Budget amount must be a non-negative number');
    expect(() => parseBudgetAmount('abc123')).toThrow('Budget amount must be a non-negative number');
  });

  it('rejects NaN and Infinity', () => {
    expect(() => parseBudgetAmount(NaN)).toThrow('Budget amount must be a non-negative number');
    expect(() => parseBudgetAmount(Infinity)).toThrow('Budget amount must be a non-negative number');
  });
});

describe('parseHours', () => {
  it('accepts numeric values', () => {
    expect(parseHours(8)).toBe(8);
    expect(parseHours(0)).toBe(0);
    expect(parseHours(1.5)).toBe(1.5);
  });

  it('coerces string values to numbers', () => {
    expect(parseHours('8')).toBe(8);
    expect(parseHours('8.00')).toBe(8);
    expect(parseHours('1.50')).toBe(1.5);
    expect(parseHours('0')).toBe(0);
  });

  it('returns null for null input', () => {
    expect(parseHours(null)).toBe(null);
  });

  it('returns null for empty string', () => {
    expect(parseHours('')).toBe(null);
  });

  it('returns undefined for undefined input', () => {
    expect(parseHours(undefined)).toBe(undefined);
  });

  it('rejects negative values', () => {
    expect(() => parseHours(-8)).toThrow('Hours must be a non-negative number');
    expect(() => parseHours('-8')).toThrow('Hours must be a non-negative number');
  });

  it('rejects invalid strings', () => {
    expect(() => parseHours('invalid')).toThrow('Hours must be a non-negative number');
  });
});

describe('parseTokenRate', () => {
  it('accepts numeric values', () => {
    expect(parseTokenRate(0.0001)).toBe(0.0001);
    expect(parseTokenRate(0)).toBe(0);
    expect(parseTokenRate(0.1234)).toBe(0.1234);
  });

  it('coerces string values to numbers', () => {
    expect(parseTokenRate('0.0001')).toBe(0.0001);
    expect(parseTokenRate('0.1234')).toBe(0.1234);
    expect(parseTokenRate('0')).toBe(0);
  });

  it('returns null for null input', () => {
    expect(parseTokenRate(null)).toBe(null);
  });

  it('returns null for empty string', () => {
    expect(parseTokenRate('')).toBe(null);
  });

  it('returns undefined for undefined input', () => {
    expect(parseTokenRate(undefined)).toBe(undefined);
  });

  it('rejects negative values', () => {
    expect(() => parseTokenRate(-0.1)).toThrow('Token rate must be a non-negative number');
    expect(() => parseTokenRate('-0.1')).toThrow('Token rate must be a non-negative number');
  });

  it('rejects invalid strings', () => {
    expect(() => parseTokenRate('invalid')).toThrow('Token rate must be a non-negative number');
  });
});
