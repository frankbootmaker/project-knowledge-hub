import { describe, expect, it } from 'vitest';
import { PROJECT_SECTIONS } from './project-sections';
import {
  findActiveNavItem,
  inferNavSection,
  isNavItemAvailable,
  isRailItemActive,
  matchNavItem,
  NAV_SECTIONS,
  navAvailabilityContext,
  parseAppPath,
  parseNavSection,
  projectTopHref,
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
    expect(inferNavSection('/workspaces/platform/projects/renewal')).toBe('control');
    expect(inferNavSection('/workspaces/platform/projects/renewal', 'project-raid')).toBe(
      'control',
    );
    expect(inferNavSection('/workspaces/platform/projects/renewal', 'project-top')).toBe('control');
    expect(inferNavSection('/workspaces/platform/projects/renewal', 'project-knowledge')).toBe(
      'control',
    );
    expect(inferNavSection('/workspaces/platform/media')).toBe('knowledge');
    expect(inferNavSection('/workspaces/platform/projects/renewal', 'project-reports')).toBe(
      'control',
    );
    expect(
      inferNavSection(
        '/workspaces/platform/projects/renewal',
        'project-delivery',
        '?delivery=scrum',
      ),
    ).toBe('delivery-finance');
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
    const delivery = NAV_SECTIONS.flatMap((section) => section.items).find(
      (item) => item.id === 'scrum',
    );
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
    const overview = NAV_SECTIONS.flatMap((section) => section.items).find(
      (item) => item.id === 'overview',
    );
    expect(overview).toBeTruthy();
    expect(matchNavItem(overview!, ctx, '/workspaces/platform/projects/renewal', '', '')).toBe(
      true,
    );
  });

  it('finds my work on the dashboard', () => {
    const item = findActiveNavItem(
      { workspaceSlug: null, projectSlug: null, isAdmin: false },
      '/dashboard',
    );
    expect(item?.id).toBe('my-work');
  });

  it('points media library at the workspace media catalogue', () => {
    const media = NAV_SECTIONS.flatMap((section) => section.items).find(
      (item) => item.id === 'media',
    );
    expect(media).toBeTruthy();
    expect(media!.href(ctx)).toBe('/workspaces/platform/media');
    expect(matchNavItem(media!, ctx, '/workspaces/platform/media')).toBe(true);
    expect(matchNavItem(media!, ctx, '/workspaces/platform/document-imports/new')).toBe(false);
  });

  it('points reports at the project reports section', () => {
    const reports = NAV_SECTIONS.flatMap((section) => section.items).find(
      (item) => item.id === 'reports',
    );
    expect(reports).toBeTruthy();
    expect(reports!.href(ctx)).toBe('/workspaces/platform/projects/renewal#project-reports');
    expect(
      matchNavItem(reports!, ctx, '/workspaces/platform/projects/renewal', 'project-reports'),
    ).toBe(true);
    expect(
      matchNavItem(reports!, ctx, '/workspaces/platform/projects/renewal', 'project-overview'),
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
    expect(ids).toEqual(['personal', 'delivery-finance', 'control', 'knowledge', 'admin']);
  });

  it('hides admin for non-admins', () => {
    const member = {
      workspaceSlug: 'platform',
      projectSlug: 'renewal',
      isAdmin: false,
    };
    expect(visibleNavSections(member).map((section) => section.id)).not.toContain('admin');
  });

  it('keeps reports in control and hides the empty ops group', () => {
    const ops = NAV_SECTIONS.find((section) => section.id === 'ops')!;
    expect(ops.items).toEqual([]);
    expect(visibleNavItems(ops, ctx)).toEqual([]);
    expect(visibleNavSections(ctx).map((section) => section.id)).not.toContain('ops');
    const reports = NAV_SECTIONS.flatMap((section) => section.items).find(
      (item) => item.id === 'reports',
    )!;
    expect(
      isNavItemAvailable(reports, {
        workspaceSlug: 'platform',
        projectSlug: null,
        isAdmin: false,
      }),
    ).toBe(false);
    expect(isNavItemAvailable(reports, ctx)).toBe(true);
    expect(reports.href(ctx)).toBe('/workspaces/platform/projects/renewal#project-reports');
  });

  it('puts every project section in control once, and keeps stakeholder views', () => {
    const control = NAV_SECTIONS.find((section) => section.id === 'control')!;
    expect(control.items.map((item) => item.id)).toEqual([
      'overview',
      'reports',
      'baseline',
      'stakeholders',
      'utilization',
      'org',
      'delivery',
      'budget',
      'raid',
      'change',
      'systems',
      'project-knowledge',
    ]);
    const delivery = NAV_SECTIONS.find((section) => section.id === 'delivery-finance')!;
    expect(delivery.items.map((item) => item.id)).toEqual(['scrum', 'timeline', 'calendar']);
    const ids = NAV_SECTIONS.flatMap((section) => section.items.map((item) => item.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const section of PROJECT_SECTIONS) {
      const item = control.items.find((row) => row.id === section.navItemId);
      expect(item?.href(ctx)).toBe(`/workspaces/platform/projects/renewal#${section.anchor}`);
    }
    const library = NAV_SECTIONS.flatMap((section) => section.items).find(
      (item) => item.id === 'knowledge',
    )!;
    expect(library.href(ctx)).toBe('/workspaces/platform');
    expect(matchNavItem(library, ctx, '/workspaces/platform')).toBe(true);
    expect(matchNavItem(library, ctx, '/workspaces/platform/media')).toBe(false);
    expect(projectTopHref(ctx)).toBe('/workspaces/platform/projects/renewal#project-top');
  });

  it('uses the scroll spy anchor for section links', () => {
    const path = '/workspaces/platform/projects/renewal';
    const budget = NAV_SECTIONS.flatMap((section) => section.items).find(
      (item) => item.id === 'budget',
    )!;
    const overview = NAV_SECTIONS.flatMap((section) => section.items).find(
      (item) => item.id === 'overview',
    )!;
    const stakeholders = NAV_SECTIONS.flatMap((section) => section.items).find(
      (item) => item.id === 'stakeholders',
    )!;
    const org = NAV_SECTIONS.flatMap((section) => section.items).find((item) => item.id === 'org')!;
    expect(isRailItemActive(budget, ctx, path, '', '', 'project-budget')).toBe(true);
    expect(isRailItemActive(overview, ctx, path, '', '', 'project-budget')).toBe(false);
    expect(
      isRailItemActive(stakeholders, ctx, path, '', '?stakeholders=org', 'project-stakeholders'),
    ).toBe(false);
    expect(isRailItemActive(org, ctx, path, '', '?stakeholders=org', 'project-stakeholders')).toBe(
      true,
    );
    expect(isRailItemActive(overview, ctx, path, '', '', null)).toBe(true);
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
    expect(navAvailabilityContext('/workspaces/platform', false)).toEqual({
      workspaceSlug: 'platform',
      projectSlug: null,
      isAdmin: false,
    });
    expect(navAvailabilityContext('/workspaces/platform/projects/renewal', true)).toEqual({
      workspaceSlug: 'platform',
      projectSlug: 'renewal',
      isAdmin: true,
    });
    expect(
      visibleNavSections(navAvailabilityContext('/dashboard', false)).map((section) => section.id),
    ).toEqual(['personal']);
  });
});
