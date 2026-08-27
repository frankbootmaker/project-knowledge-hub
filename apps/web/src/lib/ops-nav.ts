export const NAV_SECTION_IDS = [
  'personal',
  'delivery-finance',
  'control',
  'knowledge',
  'ops',
  'admin',
] as const;

export type NavSectionId = (typeof NAV_SECTION_IDS)[number];

export const defaultNavSection: NavSectionId = 'personal';

export type NavIconName =
  | 'personal'
  | 'deliveryFinance'
  | 'control'
  | 'knowledge'
  | 'ops'
  | 'admin'
  | 'myWork'
  | 'workspace'
  | 'search'
  | 'overview'
  | 'delivery'
  | 'scrum'
  | 'timeline'
  | 'calendar'
  | 'budget'
  | 'systems'
  | 'raid'
  | 'stakeholders'
  | 'utilization'
  | 'org'
  | 'baseline'
  | 'knowledgeItem'
  | 'media'
  | 'archive'
  | 'import'
  | 'agents'
  | 'reports'
  | 'monitoring'
  | 'apiClients'
  | 'storage'
  | 'aiProviders'
  | 'backups'
  | 'mcpSetup'
  | 'brand'
  | 'users'
  | 'organizations'
  | 'memberships'
  | 'audit'
  | 'email'
  | 'templates'
  | 'adminArchive';

export type NavContext = {
  workspaceSlug: string | null;
  projectSlug: string | null;
  isAdmin: boolean;
};

export type NavItemId =
  | 'my-work'
  | 'workspace'
  | 'search'
  | 'overview'
  | 'delivery'
  | 'scrum'
  | 'timeline'
  | 'calendar'
  | 'budget'
  | 'systems'
  | 'raid'
  | 'stakeholders'
  | 'utilization'
  | 'org'
  | 'baseline'
  | 'knowledge'
  | 'media'
  | 'archive'
  | 'import'
  | 'agents'
  | 'reports'
  | 'admin-overview'
  | 'admin-monitoring'
  | 'admin-clients'
  | 'admin-storage'
  | 'admin-ai'
  | 'admin-backups'
  | 'admin-mcp'
  | 'admin-brand'
  | 'admin-users'
  | 'admin-organizations'
  | 'admin-memberships'
  | 'admin-audit'
  | 'admin-email'
  | 'admin-templates'
  | 'admin-archive';

/** Context needed before an item is offered in the rail. `project` implies workspace. */
export type NavItemRequires = 'workspace' | 'project';

export type NavItemDef = {
  id: NavItemId;
  icon: NavIconName;
  labelKey: string;
  adminOnly?: boolean;
  requires?: NavItemRequires;
  href: (ctx: NavContext) => string;
};

export type NavSectionDef = {
  id: NavSectionId;
  icon: NavIconName;
  labelKey: string;
  adminOnly?: boolean;
  items: NavItemDef[];
};

function workspaceHref(ctx: NavContext, suffix = ''): string {
  if (!ctx.workspaceSlug) {
    return '/workspaces';
  }
  return `/workspaces/${ctx.workspaceSlug}${suffix}`;
}

function projectHref(
  ctx: NavContext,
  hash = '',
  search = '',
): string {
  if (!ctx.workspaceSlug || !ctx.projectSlug) {
    return ctx.workspaceSlug
      ? `/workspaces/${ctx.workspaceSlug}`
      : '/workspaces';
  }
  return `/workspaces/${ctx.workspaceSlug}/projects/${ctx.projectSlug}${search}${hash}`;
}

export const NAV_SECTIONS: NavSectionDef[] = [
  {
    id: 'personal',
    icon: 'personal',
    labelKey: 'sectionPersonal',
    items: [
      { id: 'my-work', icon: 'myWork', labelKey: 'myWork', href: () => '/dashboard' },
      {
        id: 'workspace',
        icon: 'workspace',
        labelKey: 'workspaceProjects',
        href: (ctx) => workspaceHref(ctx),
      },
      { id: 'search', icon: 'search', labelKey: 'globalSearch', href: () => '/search' },
    ],
  },
  {
    id: 'delivery-finance',
    icon: 'deliveryFinance',
    labelKey: 'sectionDelivery',
    items: [
      {
        id: 'overview',
        icon: 'overview',
        labelKey: 'overview',
        requires: 'project',
        href: (ctx) => projectHref(ctx, '#project-overview'),
      },
      {
        id: 'delivery',
        icon: 'delivery',
        labelKey: 'delivery',
        requires: 'project',
        href: (ctx) => projectHref(ctx, '#project-delivery', '?delivery=board'),
      },
      {
        id: 'scrum',
        icon: 'scrum',
        labelKey: 'scrum',
        requires: 'project',
        href: (ctx) => projectHref(ctx, '#project-delivery', '?delivery=scrum'),
      },
      {
        id: 'timeline',
        icon: 'timeline',
        labelKey: 'timeline',
        requires: 'project',
        href: (ctx) => projectHref(ctx, '#project-delivery', '?delivery=timeline'),
      },
      {
        id: 'calendar',
        icon: 'calendar',
        labelKey: 'calendar',
        requires: 'project',
        href: (ctx) => projectHref(ctx, '#project-delivery', '?delivery=calendar'),
      },
      {
        id: 'budget',
        icon: 'budget',
        labelKey: 'budget',
        requires: 'project',
        href: (ctx) => projectHref(ctx, '#project-budget'),
      },
    ],
  },
  {
    id: 'control',
    icon: 'control',
    labelKey: 'sectionControl',
    items: [
      {
        id: 'systems',
        icon: 'systems',
        labelKey: 'systems',
        requires: 'project',
        href: (ctx) => projectHref(ctx, '#project-systems'),
      },
      {
        id: 'raid',
        icon: 'raid',
        labelKey: 'raid',
        requires: 'project',
        href: (ctx) => projectHref(ctx, '#project-raid'),
      },
      {
        id: 'stakeholders',
        icon: 'stakeholders',
        labelKey: 'stakeholders',
        requires: 'project',
        href: (ctx) => projectHref(ctx, '#project-stakeholders'),
      },
      {
        id: 'utilization',
        icon: 'utilization',
        labelKey: 'utilization',
        requires: 'project',
        href: (ctx) =>
          projectHref(ctx, '#project-stakeholders', '?utilization=1'),
      },
      {
        id: 'org',
        icon: 'org',
        labelKey: 'orgChart',
        requires: 'project',
        href: (ctx) =>
          projectHref(ctx, '#project-stakeholders', '?stakeholders=org'),
      },
      {
        id: 'baseline',
        icon: 'baseline',
        labelKey: 'baseline',
        requires: 'project',
        href: (ctx) => projectHref(ctx, '#project-baseline'),
      },
    ],
  },
  {
    id: 'knowledge',
    icon: 'knowledge',
    labelKey: 'sectionKnowledge',
    items: [
      {
        id: 'knowledge',
        icon: 'knowledgeItem',
        labelKey: 'knowledgeLibrary',
        requires: 'workspace',
        href: (ctx) =>
          ctx.projectSlug
            ? projectHref(ctx, '#project-knowledge')
            : workspaceHref(ctx),
      },
      {
        id: 'media',
        icon: 'media',
        labelKey: 'mediaLibrary',
        requires: 'workspace',
        href: (ctx) => workspaceHref(ctx, '/media'),
      },
      {
        id: 'archive',
        icon: 'archive',
        labelKey: 'archive',
        requires: 'workspace',
        href: (ctx) => workspaceHref(ctx, '/archived'),
      },
      {
        id: 'import',
        icon: 'import',
        labelKey: 'documentImport',
        requires: 'workspace',
        href: (ctx) => workspaceHref(ctx, '/imports'),
      },
    ],
  },
  {
    id: 'ops',
    icon: 'ops',
    labelKey: 'sectionOps',
    items: [
      {
        id: 'agents',
        icon: 'agents',
        labelKey: 'mcpAgents',
        href: () => '/account/ai-connections',
      },
      {
        id: 'reports',
        icon: 'reports',
        labelKey: 'reports',
        requires: 'project',
        href: (ctx) => projectHref(ctx, '#project-reports'),
      },
    ],
  },
  {
    id: 'admin',
    icon: 'admin',
    labelKey: 'sectionAdmin',
    adminOnly: true,
    items: [
      {
        id: 'admin-overview',
        icon: 'overview',
        labelKey: 'adminOverview',
        adminOnly: true,
        href: () => '/admin',
      },
      {
        id: 'admin-monitoring',
        icon: 'monitoring',
        labelKey: 'adminMonitoring',
        adminOnly: true,
        href: () => '/admin/monitoring',
      },
      {
        id: 'admin-clients',
        icon: 'apiClients',
        labelKey: 'adminClients',
        adminOnly: true,
        href: () => '/admin/api-clients',
      },
      {
        id: 'admin-storage',
        icon: 'storage',
        labelKey: 'adminStorage',
        adminOnly: true,
        href: () => '/admin/storage',
      },
      {
        id: 'admin-ai',
        icon: 'aiProviders',
        labelKey: 'adminAi',
        adminOnly: true,
        href: () => '/admin/ai-providers',
      },
      {
        id: 'admin-backups',
        icon: 'backups',
        labelKey: 'adminBackups',
        adminOnly: true,
        href: () => '/admin/backups',
      },
      {
        id: 'admin-mcp',
        icon: 'mcpSetup',
        labelKey: 'adminMcp',
        adminOnly: true,
        href: () => '/admin/mcp-setup',
      },
      {
        id: 'admin-brand',
        icon: 'brand',
        labelKey: 'adminBrand',
        adminOnly: true,
        href: () => '/admin/brand',
      },
      {
        id: 'admin-users',
        icon: 'users',
        labelKey: 'adminUsers',
        adminOnly: true,
        href: () => '/admin/users',
      },
      {
        id: 'admin-organizations',
        icon: 'organizations',
        labelKey: 'adminOrganizations',
        adminOnly: true,
        href: () => '/admin/organizations',
      },
      {
        id: 'admin-memberships',
        icon: 'memberships',
        labelKey: 'adminMemberships',
        adminOnly: true,
        href: () => '/admin/memberships',
      },
      {
        id: 'admin-audit',
        icon: 'audit',
        labelKey: 'adminAudit',
        adminOnly: true,
        href: () => '/admin/audit',
      },
      {
        id: 'admin-email',
        icon: 'email',
        labelKey: 'adminEmail',
        adminOnly: true,
        href: () => '/admin/email',
      },
      {
        id: 'admin-templates',
        icon: 'templates',
        labelKey: 'adminTemplates',
        adminOnly: true,
        href: () => '/admin/templates',
      },
      {
        id: 'admin-archive',
        icon: 'adminArchive',
        labelKey: 'adminArchive',
        adminOnly: true,
        href: () => '/admin/archive',
      },
    ],
  },
];

export function isNavItemAvailable(item: NavItemDef, ctx: NavContext): boolean {
  if (item.adminOnly && !ctx.isAdmin) {
    return false;
  }
  if (item.requires === 'project' && !ctx.projectSlug) {
    return false;
  }
  if (item.requires === 'workspace' && !ctx.workspaceSlug) {
    return false;
  }
  return true;
}

export function visibleNavItems(
  section: NavSectionDef,
  ctx: NavContext,
): NavItemDef[] {
  return section.items.filter((item) => isNavItemAvailable(item, ctx));
}

export function visibleNavSections(ctx: NavContext): NavSectionDef[] {
  return NAV_SECTIONS.filter((section) => {
    if (section.adminOnly && !ctx.isAdmin) {
      return false;
    }
    return visibleNavItems(section, ctx).length > 0;
  });
}

export function resolveActiveNavSection(
  preferred: NavSectionId,
  ctx: NavContext,
): NavSectionId {
  const visible = visibleNavSections(ctx);
  if (visible.some((section) => section.id === preferred)) {
    return preferred;
  }
  return visible[0]?.id ?? defaultNavSection;
}

export function isNavSectionId(
  value: string | undefined | null,
): value is NavSectionId {
  return (NAV_SECTION_IDS as readonly string[]).includes(value ?? '');
}

export function parseNavSection(
  value: string | undefined | null,
): NavSectionId {
  return isNavSectionId(value) ? value : defaultNavSection;
}

export function parseAppPath(pathname: string): {
  workspaceSlug: string | null;
  projectSlug: string | null;
} {
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] !== 'workspaces' || !parts[1]) {
    return { workspaceSlug: null, projectSlug: null };
  }
  const workspaceSlug = parts[1];
  const projectSlug =
    parts[2] === 'projects' && parts[3] ? parts[3] : null;
  return { workspaceSlug, projectSlug };
}

export function inferNavSection(
  pathname: string,
  hash = '',
  search = '',
): NavSectionId {
  if (pathname.startsWith('/admin')) {
    return 'admin';
  }
  if (pathname.startsWith('/account/ai-connections')) {
    return 'ops';
  }
  if (pathname.startsWith('/account')) {
    return 'personal';
  }
  if (pathname === '/search' || pathname.startsWith('/search/')) {
    return 'personal';
  }
  if (pathname === '/dashboard' || pathname === '/') {
    return 'personal';
  }
  if (pathname === '/archived') {
    return 'knowledge';
  }
  if (pathname === '/workspaces' || pathname === '/workspaces/new') {
    return 'personal';
  }

  const { projectSlug } = parseAppPath(pathname);
  if (pathname.includes('/archived')) {
    return 'knowledge';
  }
  if (pathname.includes('/imports') || pathname.includes('/document-imports')) {
    return 'knowledge';
  }
  if (pathname.includes('/media')) {
    return 'knowledge';
  }
  if (pathname.includes('/records')) {
    return 'knowledge';
  }
  if (pathname.includes('/git')) {
    return 'ops';
  }
  if (pathname.includes('/systems')) {
    return 'control';
  }
  if (projectSlug) {
    const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
    if (params.get('stakeholders') === 'org' || params.get('utilization') === '1') {
      return 'control';
    }
    if (hash === 'project-raid' || hash === 'project-stakeholders'
      || hash === 'project-baseline' || hash === 'project-systems'
      || hash === 'project-change') {
      return 'control';
    }
    if (hash === 'project-knowledge') {
      return 'knowledge';
    }
    if (hash === 'project-reports') {
      return 'ops';
    }
    if (hash === 'project-budget' || hash === 'project-delivery'
      || params.has('delivery')) {
      return 'delivery-finance';
    }
    return 'delivery-finance';
  }
  if (pathname.startsWith('/workspaces/')) {
    return 'knowledge';
  }
  return 'personal';
}

export function matchNavItem(
  item: NavItemDef,
  ctx: NavContext,
  pathname: string,
  hash = '',
  search = '',
): boolean {
  const href = item.href(ctx);
  const [pathAndQuery = '', hrefHash = ''] = href.split('#');
  const [hrefPath = '', hrefQuery = ''] = pathAndQuery.split('?');
  const pathMatches =
    pathname === hrefPath ||
    (hrefPath !== '/' && pathname.startsWith(`${hrefPath}/`));

  if (item.id === 'my-work') {
    return pathname === '/dashboard' || pathname === '/';
  }
  if (item.id === 'overview') {
    if (!ctx.workspaceSlug || !ctx.projectSlug) {
      return false;
    }
    return (
      pathname === `/workspaces/${ctx.workspaceSlug}/projects/${ctx.projectSlug}`
      && (hash === 'project-overview' || hash === '')
    );
  }
  if (item.id === 'workspace') {
    return (
      pathname === '/workspaces' ||
      pathname === '/workspaces/new' ||
      (Boolean(ctx.workspaceSlug)
        && pathname === `/workspaces/${ctx.workspaceSlug}`)
    );
  }
  if (item.id === 'search') {
    return pathname === '/search' || pathname.startsWith('/search/');
  }
  if (item.id === 'archive') {
    return pathname === '/archived' || pathname.includes('/archived');
  }
  if (item.id === 'import') {
    return pathname.includes('/imports') && !pathname.includes('/document-imports');
  }
  if (item.id === 'media') {
    return /\/media(?:\/|$)/.test(pathname);
  }
  if (item.id === 'agents') {
    return pathname.startsWith('/account/ai-connections');
  }
  if (item.id === 'admin-overview') {
    return pathname === '/admin';
  }
  if (item.id === 'admin-backups') {
    return pathname.startsWith('/admin/backups');
  }
  if (item.id === 'admin-monitoring') {
    return pathname.startsWith('/admin/monitoring');
  }
  if (item.id === 'admin-brand') {
    return pathname.startsWith('/admin/brand');
  }

  const params = new URLSearchParams(
    search.startsWith('?') ? search.slice(1) : search,
  );
  const hrefParams = new URLSearchParams(hrefQuery);

  if (hrefParams.get('delivery')) {
    return (
      pathMatches
      && hash === 'project-delivery'
      && params.get('delivery') === hrefParams.get('delivery')
    );
  }
  if (hrefParams.get('stakeholders') === 'org') {
    return pathMatches && params.get('stakeholders') === 'org';
  }
  if (hrefParams.get('utilization') === '1') {
    return pathMatches && params.get('utilization') === '1';
  }
  if (hrefHash) {
    return pathMatches && hash === hrefHash;
  }
  if (item.adminOnly) {
    return pathname === hrefPath || pathname.startsWith(`${hrefPath}/`);
  }
  return pathMatches && !hash;
}

export function findActiveNavItem(
  ctx: NavContext,
  pathname: string,
  hash = '',
  search = '',
): NavItemDef | null {
  for (const section of NAV_SECTIONS) {
    for (const item of section.items) {
      if (!isNavItemAvailable(item, ctx)) {
        continue;
      }
      if (matchNavItem(item, ctx, pathname, hash, search)) {
        return item;
      }
    }
  }
  return null;
}

export type HeaderCrumb = {
  href: string;
  label: string;
};

export function headerCrumbs(
  pathname: string,
  names: { workspaceName?: string | null; projectName?: string | null },
): HeaderCrumb[] {
  const { workspaceSlug, projectSlug } = parseAppPath(pathname);
  const crumbs: HeaderCrumb[] = [];
  if (pathname.startsWith('/admin')) {
    crumbs.push({ href: '/admin', label: 'Admin' });
    return crumbs;
  }
  if (pathname.startsWith('/account')) {
    crumbs.push({ href: '/account/profile', label: 'Account' });
    return crumbs;
  }
  if (pathname === '/dashboard' || pathname === '/') {
    crumbs.push({ href: '/dashboard', label: 'Personal' });
    return crumbs;
  }
  if (pathname === '/search' || pathname.startsWith('/search/')) {
    crumbs.push({ href: '/search', label: 'Search' });
    return crumbs;
  }
  if (workspaceSlug) {
    crumbs.push({
      href: `/workspaces/${workspaceSlug}`,
      label: names.workspaceName || workspaceSlug,
    });
  }
  if (projectSlug) {
    crumbs.push({
      href: `/workspaces/${workspaceSlug}/projects/${projectSlug}`,
      label: names.projectName || projectSlug,
    });
  }
  if (crumbs.length === 0) {
    crumbs.push({ href: '/workspaces', label: 'Workspaces' });
  }
  return crumbs;
}
