import { describe, expect, it } from 'vitest';
import {
  formatHumanKey,
  isValidKeyPrefix,
  parseHumanKey,
  raidKindToIssueKeyType,
  suggestKeyPrefix,
} from './issue-keys.js';

describe('suggestKeyPrefix', () => {
  it('takes three letters from a name', () => {
    expect(suggestKeyPrefix('Health Launch')).toBe('HEA');
  });

  it('uses two letters plus digit when only two letters', () => {
    expect(suggestKeyPrefix('HL1')).toBe('HL1');
  });

  it('falls back to PRJ for empty input', () => {
    expect(suggestKeyPrefix('---')).toBe('PRJ');
  });
});

describe('key prefix / human key', () => {
  it('accepts AAA and AA0', () => {
    expect(isValidKeyPrefix('ABC')).toBe(true);
    expect(isValidKeyPrefix('hl1')).toBe(true);
    expect(isValidKeyPrefix('A1B')).toBe(false);
    expect(isValidKeyPrefix('ABCD')).toBe(false);
  });

  it('parses and formats keys', () => {
    expect(parseHumanKey('hl1-t-12')).toEqual({
      prefix: 'HL1',
      issueKeyType: 'T',
      issueNumber: 12,
    });
    expect(formatHumanKey('HL1', 'RR', 3)).toBe('HL1-RR-3');
    expect(parseHumanKey('HL1-T-0')).toBeNull();
  });

  it('maps raid kinds', () => {
    expect(raidKindToIssueKeyType('risk')).toBe('RR');
    expect(raidKindToIssueKeyType('issue')).toBe('RI');
  });
});
