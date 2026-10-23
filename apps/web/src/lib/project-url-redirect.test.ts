import { describe, expect, it } from 'vitest';
import {
  replaceIssueKeyQuery,
  replaceProjectSlugInPath,
} from './project-url-redirect';

describe('replaceIssueKeyQuery', () => {
  it('redirects an old task key to the entity id', () => {
    expect(
      replaceIssueKeyQuery({
        pathname: '/workspaces/bootmaker/projects/relayhorizon',
        task: 'OUT-T-12',
        raid: null,
        change: null,
        param: 'task',
        entityId: 'task-1',
      }),
    ).toBe(
      '/workspaces/bootmaker/projects/relayhorizon?task=task-1#project-delivery',
    );
  });

  it('keeps the other query params', () => {
    expect(
      replaceIssueKeyQuery({
        pathname: '/workspaces/bootmaker/projects/relayhorizon',
        task: 'task-1',
        raid: 'OUT-RR-3',
        change: null,
        param: 'raid',
        entityId: 'raid-3',
      }),
    ).toBe(
      '/workspaces/bootmaker/projects/relayhorizon?task=task-1&raid=raid-3#project-raid',
    );
  });
});

describe('replaceProjectSlugInPath', () => {
  it('rewrites the project segment and keeps nested records', () => {
    expect(
      replaceProjectSlugInPath(
        '/workspaces/bootmaker/projects/outpost/records/charter',
        'bootmaker',
        'outpost',
        'relayhorizon',
      ),
    ).toBe('/workspaces/bootmaker/projects/relayhorizon/records/charter');
  });

  it('does not treat a longer slug as the old slug', () => {
    expect(
      replaceProjectSlugInPath(
        '/workspaces/bootmaker/projects/outpost-notes',
        'bootmaker',
        'outpost',
        'relayhorizon',
      ),
    ).toBeNull();
  });
});
