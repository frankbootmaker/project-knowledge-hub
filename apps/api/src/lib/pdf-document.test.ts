import { describe, expect, it } from 'vitest';
import { fitColumnWidths, splitTableColumns } from './pdf-document.js';

describe('splitTableColumns', () => {
  it('keeps a fitting table in a single chunk', () => {
    expect(splitTableColumns([100, 100, 100], 400, false)).toEqual([[0, 1, 2]]);
  });

  it('splits columns that overflow the page width', () => {
    expect(splitTableColumns([100, 100, 100, 100], 250, false)).toEqual([
      [0, 1],
      [2, 3],
    ]);
  });

  it('repeats the key column on continuation chunks', () => {
    expect(splitTableColumns([60, 100, 100, 100], 200, true)).toEqual([
      [0, 1],
      [0, 2],
      [0, 3],
    ]);
  });

  it('always places at least one column per chunk', () => {
    expect(splitTableColumns([500, 500], 100, false)).toEqual([[0], [1]]);
  });
});

describe('fitColumnWidths', () => {
  it('leaves widths untouched when they already fit', () => {
    expect(fitColumnWidths([50, 60], 200)).toEqual([50, 60]);
  });

  it('shrinks wide columns to the available width', () => {
    const widths = fitColumnWidths([200, 200, 200], 300);
    const total = widths.reduce((sum, width) => sum + width, 0);
    expect(total).toBeLessThanOrEqual(300.5);
    for (const width of widths) {
      expect(width).toBeGreaterThanOrEqual(16);
    }
  });

  it('keeps narrow columns above their minimum while squeezing wide ones', () => {
    const widths = fitColumnWidths([9, 300, 300], 320);
    expect(widths[0]).toBeCloseTo(9, 1);
    expect(widths[1]).toBeLessThan(300);
    expect(widths[1]).toBeGreaterThanOrEqual(16);
  });
});
