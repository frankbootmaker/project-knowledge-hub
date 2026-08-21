import { describe, expect, it } from 'vitest';
import {
  findActiveNavItem,
  inferNavSection,
  matchNavItem,
  NAV_SECTIONS,
  parseAppPath,
  parseNavSection,
} from './ops-nav';

const ctx = {
  workspaceSlug: 'platform',
  projectSlug: 'renewal',
  isAdmin: true,
};

describe('ops nav', () => {
  it('parses workspace and project slugs', () => {
    expect(parseAppPath('/workspaces/platform/projects/renewal')).toEqual({
      workspaceSlug: 'platform',
      projectSlug: 'renewal',
    });
    expect(parseAppPath('/dashboard')).toEqual({
      workspaceSlug: null,
      projectSlug: null,
    });
  });

  it('infers sections from routes', () => {
    expect(inferNavSection('/dashboard')).toBe('personal');
    expect(inferNavSection('/admin/users')).toBe('admin');
    expect(inferNavSection('/account/ai-connections')).toBe('ops');
    expect(inferNavSection('/workspaces/platform/projects/renewal')).toBe(
      'delivery-finance',
    );
    expect(
      inferNavSection(
        '/workspaces/platform/projects/renewal',
        'project-raid',
      ),
    ).toBe('control');
    expect(inferNavSection('/workspaces/platform/media')).toBe('knowledge');
    expect(
      inferNavSection(
        '/workspaces/platform/projects/renewal',
        'project-reports',
      ),
    ).toBe('ops');
  });

  it('rejects unknown stored sections', () => {
    expect(parseNavSection('nope')).toBe('personal');
    expect(parseNavSection('admin')).toBe('admin');
  });

  it('maps every nav item to an in-app path', () => {
    for (const section of NAV_SECTIONS) {
      for (const item of section.items) {
        const href = item.href(ctx);
        expect(href.startsWith('/')).toBe(true);
        expect(href.includes('undefined')).toBe(false);
      }
    }
  });

  it('matches delivery view query params', () => {
    const delivery = NAV_SECTIONS
      .flatMap((section) => section.items)
      .find((item) => item.id === 'scrum');
    expect(delivery).toBeTruthy();
    expect(
      matchNavItem(
        delivery!,
        ctx,
        '/workspaces/platform/projects/renewal',
        'project-delivery',
        '?delivery=scrum',
      ),
    ).toBe(true);
    expect(
      matchNavItem(
        delivery!,
        ctx,
        '/workspaces/platform/projects/renewal',
        'project-delivery',
        '?delivery=board',
      ),
    ).toBe(false);
  });

  it('treats a project page with no hash as overview', () => {
    const overview = NAV_SECTIONS
      .flatMap((section) => section.items)
      .find((item) => item.id === 'overview');
    expect(overview).toBeTruthy();
    expect(
      matchNavItem(
        overview!,
        ctx,
        '/workspaces/platform/projects/renewal',
        '',
        '',
      ),
    ).toBe(true);
  });

  it('finds my work on the dashboard', () => {
    const item = findActiveNavItem(
      { workspaceSlug: null, projectSlug: null, isAdmin: false },
      '/dashboard',
    );
    expect(item?.id).toBe('my-work');
  });

  it('points media library at the workspace media catalogue', () => {
    const media = NAV_SECTIONS
      .flatMap((section) => section.items)
      .find((item) => item.id === 'media');
    expect(media).toBeTruthy();
    expect(media!.href(ctx)).toBe('/workspaces/platform/media');
    expect(
      matchNavItem(media!, ctx, '/workspaces/platform/media'),
    ).toBe(true);
    expect(
      matchNavItem(media!, ctx, '/workspaces/platform/document-imports/new'),
    ).toBe(false);
  });

  it('points reports at the project reports section', () => {
    const reports = NAV_SECTIONS
      .flatMap((section) => section.items)
      .find((item) => item.id === 'reports');
    expect(reports).toBeTruthy();
    expect(reports!.href(ctx)).toBe(
      '/workspaces/platform/projects/renewal#project-reports',
    );
    expect(
      matchNavItem(
        reports!,
        ctx,
        '/workspaces/platform/projects/renewal',
        'project-reports',
      ),
    ).toBe(true);
    expect(
      matchNavItem(
        reports!,
        ctx,
        '/workspaces/platform/projects/renewal',
        'project-overview',
      ),
    ).toBe(false);
  });
});
