import { describe, expect, it } from 'vitest';
import {
  PROGRESS_LOG_MAX_CHARS,
  appendProgressLog,
} from './progress.js';

describe('appendProgressLog', () => {
  const fixed = new Date('2026-08-02T12:00:00.000Z');

  it('starts a log from an empty value', () => {
    expect(appendProgressLog(null, 'Reading upload', fixed)).toBe(
      '[2026-08-02T12:00:00.000Z] Reading upload',
    );
  });

  it('appends subsequent lines', () => {
    const first = appendProgressLog(null, 'Reading upload', fixed);
    const second = appendProgressLog(
      first,
      'OCR via tesseract',
      new Date('2026-08-02T12:00:01.000Z'),
    );
    expect(second).toBe(
      [
        '[2026-08-02T12:00:00.000Z] Reading upload',
        '[2026-08-02T12:00:01.000Z] OCR via tesseract',
      ].join('\n'),
    );
  });

  it('truncates from the front when over the max size', () => {
    let log = '';
    for (let i = 0; i < 2000; i += 1) {
      log = appendProgressLog(log, `line-${i}-${'x'.repeat(40)}`, fixed);
    }
    expect(log.length).toBeLessThanOrEqual(PROGRESS_LOG_MAX_CHARS);
    expect(log).toContain('line-1999');
    expect(log.startsWith('[')).toBe(true);
  });
});
