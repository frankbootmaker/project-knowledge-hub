import { describe, expect, it } from 'vitest';
import { combineSearchScore, lifecycleRankBoost, titleMatchBoost } from './ranking.js';
import { buildSnippet } from './snippet.js';

describe('search ranking', () => {
  it('boosts exact title matches above partial matches', () => {
    expect(titleMatchBoost('Tailscale Bridge', 'Tailscale Bridge')).toBeGreaterThan(
      titleMatchBoost('Other doc', 'Tailscale Bridge'),
    );
    expect(titleMatchBoost('Guide to Tailscale Bridge setup', 'Tailscale Bridge')).toBeGreaterThan(
      0,
    );
  });

  it('ranks current and verified above drafts for the same ts_rank', () => {
    const query = 'bridge';
    const title = 'Bridge config';
    const draft = combineSearchScore({
      tsRank: 0.2,
      title,
      query,
      lifecycleStatus: 'draft',
    });
    const verified = combineSearchScore({
      tsRank: 0.2,
      title,
      query,
      lifecycleStatus: 'verified',
    });
    const current = combineSearchScore({
      tsRank: 0.2,
      title,
      query,
      lifecycleStatus: 'current',
    });
    expect(current).toBeGreaterThan(verified);
    expect(verified).toBeGreaterThan(draft);
    expect(lifecycleRankBoost('current')).toBeGreaterThan(lifecycleRankBoost('draft'));
  });

  it('builds snippets around matching terms', () => {
    const snippet = buildSnippet(
      '# Deploy\n\nRun the Tailscale Headscale bridge after installing packages.',
      'Tailscale bridge',
    );
    expect(snippet.toLowerCase()).toContain('tailscale');
    expect(snippet.length).toBeLessThan(260);
  });
});
