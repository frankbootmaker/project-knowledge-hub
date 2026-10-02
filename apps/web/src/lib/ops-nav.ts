import { PROJECT_SECTIONS, PROJECT_TOP_ANCHOR, type ProjectSectionDef } from './project-sections';

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
  | 'change'
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
  | 'sso'
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
  | 'change'
  | 'stakeholders'
  | 'utilization'
  | 'org'
  | 'baseline'
  | 'knowledge'
  | 'project-knowledge'
  | 'media'
  | 'archive'
  | 'import'
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
  | 'admin-sso'
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

function projectHref(ctx: NavContext, hash = '', search = ''): string {
  const index = projectIndexPath(ctx);
  if (!index) {
    return ctx.workspaceSlug ? `/workspaces/${ctx.workspaceSlug}` : '/workspaces';
  }
  return `${index}${search}${hash}`;
}

/** Create-project route shares `[projectSlug]`; it is not a project. */
export function isProjectSlug(slug: string | null | undefined): slug is string {
  return Boolean(slug) && slug !== 'new';
}

export function projectIndexPath(ctx: NavContext): string | null {
  if (!ctx.workspaceSlug || !isProjectSlug(ctx.projectSlug)) {
    return null;
  }
  return `/workspaces/${ctx.workspaceSlug}/projects/${ctx.projectSlug}`;
}

export function projectTopHref(ctx: NavContext): string {
  return projectHref(ctx, `#${PROJECT_TOP_ANCHOR}`);
}

/** Name and tooltip for a rail link. Compact mode hides the visible label. */
export function railItemAccessibleName(label: string, statusLabel: string | null): string {
  return statusLabel ? `${label}: ${statusLabel}` : label;
}

function projectSectionNavItem(section: ProjectSectionDef): NavItemDef {
  return {
    id: section.navItemId,
    icon: section.icon,
    labelKey: section.labelKey,
    requires: 'project',
    href: (ctx) =>
      section.navItemId === 'overview'
        ? projectTopHref(ctx)
        : projectHref(ctx, `#${section.anchor}`),
  };
}

/**
 * Header shortcuts, plus Utilization and Org chart (stakeholder views).
 * Those two stay in Control and are not header chips.
 */
function controlNavItems(): NavItemDef[] {
  const items: NavItemDef[] = [];
  for (const section of PROJECT_SECTIONS) {
    items.push(projectSectionNavItem(section));
    if (section.navItemId !== 'stakeholders') {
      continue;
    }
    items.push(
      {
        id: 'utilization',
        icon: 'utilization',
        labelKey: 'utilization',
        requires: 'project',
        href: (ctx) => projectHref(ctx, '#project-stakeholders', '?utilization=1'),
      },
      {
        id: 'org',
        icon: 'org',
        labelKey: 'orgChart',
        requires: 'project',
        href: (ctx) => projectHref(ctx, '#project-stakeholders', '?stakeholders=org'),
      },
    );
  }
  return items;
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
    ],
  },
  {
    id: 'control',
    icon: 'control',
    labelKey: 'sectionControl',
    items: controlNavItems(),
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
        href: (ctx) => workspaceHref(ctx),
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
    // Reports moved to Control with the other project sections. Git routes
    // still infer Ops; with no items the group stays hidden.
    id: 'ops',
    icon: 'ops',
    labelKey: 'sectionOps',
    items: [],
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
        id: 'admin-sso',
        icon: 'sso',
        labelKey: 'adminSso',
        adminOnly: true,
        href: () => '/admin/sso',
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
  if (item.requires === 'project' && !isProjectSlug(ctx.projectSlug)) {
    return false;
  }
  if (item.requires === 'workspace' && !ctx.workspaceSlug) {
    return false;
  }
  return true;
}

/** Route-only context for which groups to show — ignores last-used prefs. */
export function navAvailabilityContext(pathname: string, isAdmin: boolean): NavContext {
  const { workspaceSlug, projectSlug } = parseAppPath(pathname);
  return { workspaceSlug, projectSlug, isAdmin };
}

export function visibleNavItems(section: NavSectionDef, ctx: NavContext): NavItemDef[] {
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

export function resolveActiveNavSection(preferred: NavSectionId, ctx: NavContext): NavSectionId {
  const visible = visibleNavSections(ctx);
  if (visible.some((section) => section.id === preferred)) {
    return preferred;
  }
  return visible[0]?.id ?? defaultNavSection;
}

export function isNavSectionId(value: string | undefined | null): value is NavSectionId {
  return (NAV_SECTION_IDS as readonly string[]).includes(value ?? '');
}

export function parseNavSection(value: string | undefined | null): NavSectionId {
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
  const rawSlug = parts[2] === 'projects' && parts[3] ? parts[3] : null;
  const projectSlug = isProjectSlug(rawSlug) ? rawSlug : null;
  return { workspaceSlug, projectSlug };
}

/** Scrum, Timeline, and Calendar are the only delivery views with a rail item. */
const RAIL_DELIVERY_VIEWS = new Set(['scrum', 'timeline', 'calendar']);

function isRailDeliveryView(value: string | null): boolean {
  return value != null && RAIL_DELIVERY_VIEWS.has(value);
}

function readSearchParams(search: string): URLSearchParams {
  return new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
}

function hashId(hash: string): string {
  return hash.startsWith('#') ? hash.slice(1) : hash;
}

export function inferNavSection(pathname: string, hash = '', search = ''): NavSectionId {
  if (pathname.startsWith('/admin')) {
    return 'admin';
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
  if (
    /^\/workspaces\/[^/]+\/(?:archived|imports|document-imports|media|records)(\/|$)/.test(
      pathname,
    )
  ) {
    return 'knowledge';
  }
  if (/^\/workspaces\/[^/]+\/git(\/|$)/.test(pathname)) {
    return 'ops';
  }
  if (pathname.includes('/systems')) {
    return 'control';
  }
  if (/^\/workspaces\/[^/]+\/projects\/new\/?$/.test(pathname)) {
    return 'control';
  }
  if (projectSlug) {
    const anchor = hashId(hash);
    const deliveryView = readSearchParams(search).get('delivery');
    if (anchor === 'project-delivery' && isRailDeliveryView(deliveryView)) {
      return 'delivery-finance';
    }
    return 'control';
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
    pathname === hrefPath || (hrefPath !== '/' && pathname.startsWith(`${hrefPath}/`));

  if (item.id === 'my-work') {
    return pathname === '/dashboard' || pathname === '/';
  }
  if (item.id === 'overview') {
    if (!ctx.workspaceSlug || !ctx.projectSlug) {
      return false;
    }
    return (
      pathname === `/workspaces/${ctx.workspaceSlug}/projects/${ctx.projectSlug}` &&
      (hash === PROJECT_TOP_ANCHOR || hash === '')
    );
  }
  if (item.id === 'workspace') {
    return (
      pathname === '/workspaces' ||
      pathname === '/workspaces/new' ||
      (Boolean(ctx.workspaceSlug) && pathname === `/workspaces/${ctx.workspaceSlug}`)
    );
  }
  if (item.id === 'search') {
    return pathname === '/search' || pathname.startsWith('/search/');
  }
  if (item.id === 'knowledge') {
    return Boolean(ctx.workspaceSlug) && pathname === `/workspaces/${ctx.workspaceSlug}`;
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

  const params = readSearchParams(search);
  const hrefParams = new URLSearchParams(hrefQuery);

  if (hrefParams.get('delivery')) {
    return (
      pathMatches &&
      hash === 'project-delivery' &&
      params.get('delivery') === hrefParams.get('delivery')
    );
  }
  if (hrefParams.get('stakeholders') === 'org') {
    return pathMatches && params.get('stakeholders') === 'org';
  }
  if (hrefParams.get('utilization') === '1') {
    return pathMatches && params.get('utilization') === '1';
  }
  if (hrefHash) {
    if (item.id === 'delivery' && isRailDeliveryView(params.get('delivery'))) {
      return false;
    }
    return pathMatches && hash === hrefHash;
  }
  if (item.adminOnly) {
    return pathname === hrefPath || pathname.startsWith(`${hrefPath}/`);
  }
  return pathMatches && !hash;
}

function hrefParts(href: string): {
  path: string;
  query: string;
  hash: string;
} {
  const [pathAndQuery = '', hrefHash = ''] = href.split('#');
  const [hrefPath = '', hrefQuery = ''] = pathAndQuery.split('?');
  return { path: hrefPath, query: hrefQuery, hash: hrefHash };
}

/**
 * Hash/route match, overridden by the project-page scroll spy when it
 * reports a visible section. View-query items (scrum, org, utilization)
 * keep the URL match so they are not double-highlighted with the section.
 */
export function isRailItemActive(
  item: NavItemDef,
  ctx: NavContext,
  pathname: string,
  hash: string,
  search: string,
  activeAnchor: string | null,
): boolean {
  if (!activeAnchor) {
    return matchNavItem(item, ctx, pathname, hash, search);
  }

  const href = hrefParts(item.href(ctx));
  const hrefParams = new URLSearchParams(href.query);
  const hasViewQuery =
    hrefParams.has('delivery') || hrefParams.has('stakeholders') || hrefParams.has('utilization');
  if (hasViewQuery || !href.hash) {
    return matchNavItem(item, ctx, pathname, hash, search);
  }

  const params = readSearchParams(search);
  const pathMatches =
    pathname === href.path || (href.path !== '/' && pathname.startsWith(`${href.path}/`));
  if (!pathMatches || href.hash !== activeAnchor) {
    return false;
  }
  if (activeAnchor === 'project-delivery' && isRailDeliveryView(params.get('delivery'))) {
    return false;
  }
  if (
    activeAnchor === 'project-stakeholders' &&
    (params.get('stakeholders') === 'org' || params.get('utilization') === '1')
  ) {
    return false;
  }
  return true;
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
