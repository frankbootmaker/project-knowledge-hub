import { describe, expect, it } from 'vitest';
import { filterSyncedPaths, pathMatches } from './path-match.js';

describe('pathMatches', () => {
  it('matches recursive docs globs', () => {
    expect(pathMatches('docs/adr/ADR-001.md', ['docs/**/*.md'])).toBe(true);
    expect(pathMatches('README.md', ['README.md'])).toBe(true);
    expect(pathMatches('src/foo.ts', ['docs/**/*.md'])).toBe(false);
  });
});

describe('filterSyncedPaths', () => {
  it('keeps markdown under include and drops excludes', () => {
    const paths = filterSyncedPaths(
      [
        'docs/a.md',
        'docs/skip/x.md',
        'README.md',
        'docs/a.ts',
        'node_modules/pkg/readme.md',
      ],
      ['docs/**/*.md', 'README.md'],
      ['docs/skip/**', '**/node_modules/**'],
    );
    expect(paths).toEqual(['docs/a.md', 'README.md']);
  });
});
