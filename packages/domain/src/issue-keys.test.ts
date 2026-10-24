import { describe, expect, it } from 'vitest';
import {
  canonicalUuid,
  formatHumanKey,
  isUuid,
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
    expect(parseHumanKey('HL1-VIS-2')).toEqual({
      prefix: 'HL1',
      issueKeyType: 'VIS',
      issueNumber: 2,
    });
    expect(formatHumanKey('HL1', 'RET', 1)).toBe('HL1-RET-1');
    expect(parseHumanKey('HL1-SP-3')).toEqual({
      prefix: 'HL1',
      issueKeyType: 'SP',
      issueNumber: 3,
    });
  });

  it('maps raid kinds', () => {
    expect(raidKindToIssueKeyType('risk')).toBe('RR');
    expect(raidKindToIssueKeyType('issue')).toBe('RI');
  });
});

describe('canonicalUuid', () => {
  const id = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

  it('lowercases and accepts urn, braces, and 32 hex', () => {
    expect(canonicalUuid(id.toUpperCase())).toBe(id);
    expect(canonicalUuid(`urn:uuid:${id.toUpperCase()}`)).toBe(id);
    expect(canonicalUuid(`{${id}}`)).toBe(id);
    expect(canonicalUuid('AAAAAAAABBBB4CCC8DDDEEEEEEEEEEEE')).toBe(id);
    expect(isUuid(`urn:uuid:${id}`)).toBe(true);
  });

  it('rejects human keys and short hex', () => {
    expect(canonicalUuid('HL1-VIS-2')).toBeNull();
    expect(canonicalUuid('aaaa')).toBeNull();
    expect(isUuid('HL1-VIS-2')).toBe(false);
  });
});
