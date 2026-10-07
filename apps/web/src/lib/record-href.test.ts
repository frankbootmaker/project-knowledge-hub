import { describe, expect, it } from 'vitest';
import { recordBaseWithSlug, recordHref } from './record-href';

describe('recordHref', () => {
  it('builds a workspace record path and optional suffix', () => {
    expect(recordHref({ workspaceSlug: 'platform', recordSlug: 'note' })).toBe(
      '/workspaces/platform/records/note',
    );
    expect(
      recordHref({
        workspaceSlug: 'platform',
        recordSlug: 'note',
        suffix: 'history',
      }),
    ).toBe('/workspaces/platform/records/note/history');
    expect(
      recordHref({
        workspaceSlug: 'platform',
        recordSlug: 'note',
        suffix: '/edit',
      }),
    ).toBe('/workspaces/platform/records/note/edit');
  });

  it('nests under a project and ignores the create-project slug', () => {
    expect(
      recordHref({
        workspaceSlug: 'platform',
        projectSlug: 'renewal',
        recordSlug: 'charter',
        suffix: 'history/2',
      }),
    ).toBe('/workspaces/platform/projects/renewal/records/charter/history/2');
    expect(
      recordHref({
        workspaceSlug: 'platform',
        projectSlug: 'new',
        recordSlug: 'note',
      }),
    ).toBe('/workspaces/platform/records/note');
    expect(
      recordHref({
        workspaceSlug: 'platform',
        projectSlug: null,
        recordSlug: 'note',
      }),
    ).toBe('/workspaces/platform/records/note');
  });

  it('replaces the record slug on a base path', () => {
    expect(recordBaseWithSlug('/workspaces/platform/projects/renewal/records/old', 'next')).toBe(
      '/workspaces/platform/projects/renewal/records/next',
    );
    expect(recordBaseWithSlug('/workspaces/platform/records/old$1', 'note$2')).toBe(
      '/workspaces/platform/records/note$2',
    );
  });
});
