import { describe, expect, it } from 'vitest';
import { mapPathToRecord, titleFromMarkdown } from './path-map.js';

describe('mapPathToRecord', () => {
  it('maps ADR paths to decision', () => {
    expect(mapPathToRecord('docs/adr/ADR-001-multiple-content-sources.md').recordType).toBe(
      'decision',
    );
  });

  it('maps deployment guides', () => {
    expect(mapPathToRecord('docs/deployment/DOKPLOY.md').recordType).toBe('deployment-guide');
  });
});

describe('titleFromMarkdown', () => {
  it('prefers first heading', () => {
    expect(titleFromMarkdown('# Hello\n\nbody', 'docs/x.md')).toBe('Hello');
  });
});
