import { describe, expect, it } from 'vitest';
import {
  evaluatePasswordStrength,
  passwordSchema,
  PASSWORD_MIN_LENGTH,
} from './password.js';

describe('evaluatePasswordStrength', () => {
  it('marks empty passwords', () => {
    expect(evaluatePasswordStrength('').level).toBe('empty');
    expect(evaluatePasswordStrength('').acceptable).toBe(false);
  });

  it('treats short passwords as weak when few rules are met', () => {
    const result = evaluatePasswordStrength('aaaa');
    expect(result.level).toBe('weak');
    expect(result.acceptable).toBe(false);
    expect(result.requirements.length).toBe(false);
  });

  it('accepts 8+ with uppercase and non-letter as safe', () => {
    const result = evaluatePasswordStrength('Abcdefg1');
    expect(result.acceptable).toBe(true);
    expect(result.level).toBe('safe');
    expect(result.score).toBe(3);
  });

  it('rates longer compliant passwords as strong', () => {
    const result = evaluatePasswordStrength('Abcdefghijk1');
    expect(result.level).toBe('strong');
    expect(result.acceptable).toBe(true);
  });

  it('requires uppercase', () => {
    const result = evaluatePasswordStrength('abcdefg1');
    expect(result.requirements.uppercase).toBe(false);
    expect(result.acceptable).toBe(false);
  });

  it('requires a non-letter character', () => {
    const result = evaluatePasswordStrength('Abcdefgh');
    expect(result.requirements.nonLetter).toBe(false);
    expect(result.acceptable).toBe(false);
  });
});

describe('passwordSchema', () => {
  it(`requires at least ${PASSWORD_MIN_LENGTH} characters plus complexity`, () => {
    expect(passwordSchema.safeParse('short').success).toBe(false);
    expect(passwordSchema.safeParse('abcdefgh').success).toBe(false);
    expect(passwordSchema.safeParse('Abcdefgh').success).toBe(false);
    expect(passwordSchema.safeParse('Abcdefg1').success).toBe(true);
  });
});
