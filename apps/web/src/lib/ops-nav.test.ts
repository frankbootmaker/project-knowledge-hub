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
});
