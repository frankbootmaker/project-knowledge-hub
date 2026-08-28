import { describe, expect, it } from 'vitest';
import {
  findActiveNavItem,
  inferNavSection,
  isNavItemAvailable,
  matchNavItem,
  NAV_SECTIONS,
  navAvailabilityContext,
  parseAppPath,
  parseNavSection,
  resolveActiveNavSection,
  visibleNavItems,
  visibleNavSections,
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
    expect(inferNavSection('/account/ai-connections')).toBe('personal');
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

  it('hides delivery, control, and ops without a project; keeps personal', () => {
    const bare = {
      workspaceSlug: null,
      projectSlug: null,
      isAdmin: false,
    };
    const ids = visibleNavSections(bare).map((section) => section.id);
    expect(ids).toEqual(['personal']);
    expect(ids).not.toContain('delivery-finance');
    expect(ids).not.toContain('control');
    expect(ids).not.toContain('knowledge');
    expect(ids).not.toContain('ops');
    expect(ids).not.toContain('admin');
  });

  it('shows knowledge with a workspace but not delivery without a project', () => {
    const workspaceOnly = {
      workspaceSlug: 'platform',
      projectSlug: null,
      isAdmin: false,
    };
    const ids = visibleNavSections(workspaceOnly).map((section) => section.id);
    expect(ids).toContain('personal');
    expect(ids).toContain('knowledge');
    expect(ids).not.toContain('ops');
    expect(ids).not.toContain('delivery-finance');
    expect(ids).not.toContain('control');
  });

  it('shows delivery and control when a project is set', () => {
    const ids = visibleNavSections(ctx).map((section) => section.id);
    expect(ids).toEqual([
      'personal',
      'delivery-finance',
      'control',
      'knowledge',
      'ops',
      'admin',
    ]);
  });

  it('hides admin for non-admins', () => {
    const member = {
      workspaceSlug: 'platform',
      projectSlug: 'renewal',
      isAdmin: false,
    };
    expect(visibleNavSections(member).map((section) => section.id)).not.toContain(
      'admin',
    );
  });

  it('hides ops reports without a project', () => {
    const workspaceOnly = {
      workspaceSlug: 'platform',
      projectSlug: null,
      isAdmin: false,
    };
    const ops = NAV_SECTIONS.find((section) => section.id === 'ops')!;
    const available = visibleNavItems(ops, workspaceOnly).map((item) => item.id);
    expect(available).toEqual([]);
    const reports = ops.items.find((item) => item.id === 'reports')!;
    expect(isNavItemAvailable(reports, workspaceOnly)).toBe(false);
    expect(isNavItemAvailable(reports, ctx)).toBe(true);
  });

  it('falls back when the preferred section is not visible', () => {
    const bare = {
      workspaceSlug: null,
      projectSlug: null,
      isAdmin: false,
    };
    expect(resolveActiveNavSection('delivery-finance', bare)).toBe('personal');
    expect(resolveActiveNavSection('ops', bare)).toBe('personal');
  });

  it('uses the current route, not remembered context, for group visibility', () => {
    expect(navAvailabilityContext('/dashboard', false)).toEqual({
      workspaceSlug: null,
      projectSlug: null,
      isAdmin: false,
    });
    expect(
      navAvailabilityContext('/workspaces/platform', false),
    ).toEqual({
      workspaceSlug: 'platform',
      projectSlug: null,
      isAdmin: false,
    });
    expect(
      navAvailabilityContext('/workspaces/platform/projects/renewal', true),
    ).toEqual({
      workspaceSlug: 'platform',
      projectSlug: 'renewal',
      isAdmin: true,
    });
    expect(
      visibleNavSections(navAvailabilityContext('/dashboard', false)).map(
        (section) => section.id,
      ),
    ).toEqual(['personal']);
  });
});
