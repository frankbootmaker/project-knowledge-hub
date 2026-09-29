import { describe, expect, it } from 'vitest';
import { toIsoTimestamp, roundScore } from './search-service.js';

/**
 * Unit tests for search result formatting helpers
 * These tests verify that the actual production code handles
 * timestamp and score formatting correctly without requiring a database.
 */

describe('toIsoTimestamp', () => {
  describe('Date objects', () => {
    it('converts valid Date objects to ISO 8601 format', () => {
      const date = new Date('2026-09-28T11:29:24.478Z');
      const result = toIsoTimestamp(date);
      
      expect(result).toBe('2026-09-28T11:29:24.478Z');
    });

    it('returns null for invalid Date objects', () => {
      const invalidDate = new Date('invalid');
      const result = toIsoTimestamp(invalidDate);
      
      expect(result).toBeNull();
    });
  });

  describe('PostgreSQL timestamp strings', () => {
    it('converts PostgreSQL format with +00 timezone to ISO 8601', () => {
      const postgresTimestamp = '2026-09-28 11:29:24.478+00';
      const result = toIsoTimestamp(postgresTimestamp);
      
      expect(result).toBe('2026-09-28T11:29:24.478Z');
    });

    it('normalizes PostgreSQL timestamp with space separator', () => {
      const postgresTimestamp = '2026-09-28 11:29:24+00';
      const result = toIsoTimestamp(postgresTimestamp);
      
      expect(result).toBe('2026-09-28T11:29:24.000Z');
    });

    it('handles PostgreSQL timestamps with non-UTC timezones', () => {
      const postgresTimestamp = '2026-09-28 11:29:24.478+05:30';
      const result = toIsoTimestamp(postgresTimestamp);
      
      // Should convert to UTC (subtract 5:30)
      expect(result).toBe('2026-09-28T05:59:24.478Z');
    });

    it('handles PostgreSQL timestamps with microsecond precision', () => {
      const postgresTimestamp = '2026-09-28 11:29:24.478123+00';
      const result = toIsoTimestamp(postgresTimestamp);
      
      // JavaScript Date truncates to milliseconds
      expect(result).toBe('2026-09-28T11:29:24.478Z');
    });

    it('handles already-normalized ISO 8601 strings', () => {
      const isoString = '2026-09-28T11:29:24.478Z';
      const result = toIsoTimestamp(isoString);
      
      expect(result).toBe('2026-09-28T11:29:24.478Z');
    });

    it('handles timestamps with +00:00 timezone format', () => {
      const timestamp = '2026-09-28 11:29:24.478+00:00';
      const result = toIsoTimestamp(timestamp);
      
      expect(result).toBe('2026-09-28T11:29:24.478Z');
    });
  });

  describe('null and invalid inputs', () => {
    it('returns null for null input', () => {
      const result = toIsoTimestamp(null);
      
      expect(result).toBeNull();
    });

    it('returns null for undefined input', () => {
      const result = toIsoTimestamp(undefined);
      
      expect(result).toBeNull();
    });

    it('returns null for unparseable string', () => {
      const result = toIsoTimestamp('not a timestamp');
      
      expect(result).toBeNull();
    });

    it('returns null for empty string', () => {
      const result = toIsoTimestamp('');
      
      expect(result).toBeNull();
    });

    it('returns null for non-string, non-Date values', () => {
      const result = toIsoTimestamp(12345 as never);
      
      expect(result).toBeNull();
    });
  });
});

describe('roundScore', () => {
  it('rounds scores to 4 decimal places', () => {
    const result = roundScore(3.0500000715255737);
    
    expect(result).toBe(3.05);
  });

  it('handles integer scores correctly', () => {
    const result = roundScore(5);
    
    expect(result).toBe(5);
  });

  it('handles very small scores correctly', () => {
    const result = roundScore(0.00001234);
    
    expect(result).toBe(0);
  });

  it('handles negative scores correctly', () => {
    const result = roundScore(-1.23456789);
    
    expect(result).toBe(-1.2346);
  });

  it('rounds up correctly', () => {
    const result = roundScore(2.99999);
    
    expect(result).toBe(3);
  });

  it('preserves exactly 4 decimal places when needed', () => {
    const result = roundScore(0.8765432109);
    
    expect(result).toBe(0.8765);
  });

  it('returns null for null input', () => {
    const result = roundScore(null);
    
    expect(result).toBeNull();
  });

  it('handles zero correctly', () => {
    const result = roundScore(0);
    
    expect(result).toBe(0);
  });
});
