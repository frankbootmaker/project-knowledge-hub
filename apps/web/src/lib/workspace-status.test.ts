import { describe, expect, it } from 'vitest';
import { resolveWorkspaceStatus, worstGitHealth } from './workspace-status';

describe('worstGitHealth', () => {
  it('picks the most severe status', () => {
    expect(worstGitHealth(['healthy', 'needs_sync', 'paused'])).toBe('needs_sync');
    expect(worstGitHealth(['paused', 'error'])).toBe('error');
  });
});

describe('resolveWorkspaceStatus', () => {
  it('returns archived when soft-archived', () => {
    expect(
      resolveWorkspaceStatus({
        archived: true,
        workspaceSlug: 'demo',
        gitHealthStatuses: ['error'],
      }),
    ).toMatchObject({ kind: 'archived', attentionHref: null });
  });

  it('returns healthy when sync is fine or absent', () => {
    expect(
      resolveWorkspaceStatus({
        archived: false,
        workspaceSlug: 'demo',
        gitHealthStatuses: [],
      }).kind,
    ).toBe('healthy');
    expect(
      resolveWorkspaceStatus({
        archived: false,
        workspaceSlug: 'demo',
        gitHealthStatuses: ['healthy'],
      }).kind,
    ).toBe('healthy');
  });

  it('links needs attention to git sync', () => {
    const status = resolveWorkspaceStatus({
      archived: false,
      workspaceSlug: 'demo',
      gitHealthStatuses: ['never_synced'],
    });
    expect(status.kind).toBe('needs_attention');
    expect(status.attentionHref).toBe('/workspaces/demo/git');
  });
});
