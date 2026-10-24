import {
  PROJECT_SECTIONS,
  PROJECT_TOP_ANCHOR,
  projectAnchorFromHash,
  type ProjectSectionDef,
} from './project-sections';
import {
  WORKSPACE_KNOWLEDGE_ANCHOR,
  WORKSPACE_SYSTEMS_ANCHOR,
  navItemIdForWorkspaceAnchor,
  workspaceAnchorFromHash,
} from './workspace-sections';

export const NAV_SECTION_IDS = [
  'personal',
  'delivery-finance',
  'control',
  'knowledge',
  'financials',
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
  | 'financials'
  | 'ops'
  | 'admin'
  | 'myWork'
  | 'workspace'
  | 'search'
  | 'overview'
  | 'delivery'
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
  /** Maintainer or workspace admin of the workspace in the current path. */
  canManageWorkspace?: boolean;
};

export type NavItemId =
  | 'my-work'
  | 'workspace'
  | 'search'
  | 'overview'
  | 'delivery'
  | 'budget'
  | 'systems'
  | 'raid'
  | 'change'
  | 'stakeholders'
  | 'utilization'
  | 'org'
  | 'baseline'
  | 'knowledge'
  | 'workspace-systems'
  | 'project-knowledge'
  | 'media'
  | 'archive'
  | 'import'
  | 'reports'
  | 'admin-overview'
  | 'admin-financials'
  | 'admin-monitoring'
  | 'admin-backups'
  | 'admin-mcp'
  | 'admin-brand'
  | 'admin-identity'
  | 'admin-audit'
  | 'admin-email'
  | 'admin-templates'
  | 'admin-archive'
  | 'financials-ai-cost';

/** Context needed before an item is offered in the rail. `project` implies workspace. */
export type NavItemRequires = 'workspace' | 'project';

export type NavItemDef = {
  id: NavItemId;
  icon: NavIconName;
  labelKey: string;
  adminOnly?: boolean;
  /** System admin, or a maintainer of the workspace in the path. */
  manageWorkspace?: boolean;
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

function workspaceHref(ctx: NavContext, suffix = '', hash = ''): string {
  if (!ctx.workspaceSlug) {
    return '/workspaces';
  }
  return `/workspaces/${ctx.workspaceSlug}${suffix}${hash}`;
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
 * Header shortcuts, plus views that are not header chips:
 * Utilization and Org chart. Scrum, Timeline, and Calendar stay
 * inside the Delivery section.
 */
function controlNavItems(): NavItemDef[] {
  const items: NavItemDef[] = [];
  for (const section of PROJECT_SECTIONS) {
    items.push(projectSectionNavItem(section));
    if (section.navItemId === 'stakeholders') {
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
    // The group stays in the model so a stored section id still parses, and stays hidden with no items.
    id: 'delivery-finance',
    icon: 'deliveryFinance',
    labelKey: 'sectionDelivery',
    items: [],
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
        href: (ctx) => workspaceHref(ctx, '', `#${WORKSPACE_KNOWLEDGE_ANCHOR}`),
      },
      {
        id: 'workspace-systems',
        icon: 'systems',
        labelKey: 'workspaceSystems',
        requires: 'workspace',
        href: (ctx) => workspaceHref(ctx, '', `#${WORKSPACE_SYSTEMS_ANCHOR}`),
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
    id: 'financials',
    icon: 'financials',
    labelKey: 'sectionFinancials',
    items: [
      {
        id: 'financials-ai-cost',
        icon: 'budget',
        labelKey: 'financialsAiCost',
        manageWorkspace: true,
        requires: 'workspace',
        href: (ctx) => workspaceHref(ctx, '/financials'),
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
        id: 'admin-financials',
        icon: 'financials',
        labelKey: 'sectionFinancials',
        adminOnly: true,
        href: () => '/admin/financials',
      },
      {
        id: 'admin-monitoring',
        icon: 'monitoring',
        labelKey: 'adminMonitoring',
        adminOnly: true,
        href: () => '/admin/monitoring',
      },
      {
        id: 'admin-audit',
        icon: 'audit',
        labelKey: 'adminAudit',
        adminOnly: true,
        href: () => '/admin/audit',
      },
      {
        id: 'admin-identity',
        icon: 'users',
        labelKey: 'adminIdentity',
        adminOnly: true,
        href: () => '/admin/identity',
      },
      {
        id: 'admin-mcp',
        icon: 'mcpSetup',
        labelKey: 'adminMcp',
        adminOnly: true,
        href: () => '/admin/mcp-setup',
      },
      {
        id: 'admin-backups',
        icon: 'backups',
        labelKey: 'adminBackups',
        adminOnly: true,
        href: () => '/admin/backups',
      },
      {
        id: 'admin-email',
        icon: 'email',
        labelKey: 'adminEmail',
        adminOnly: true,
        href: () => '/admin/email',
      },
      {
        id: 'admin-brand',
        icon: 'brand',
        labelKey: 'adminBrand',
        adminOnly: true,
        href: () => '/admin/brand',
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
  if (item.manageWorkspace && !ctx.isAdmin && !ctx.canManageWorkspace) {
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
export function navAvailabilityContext(
  pathname: string,
  isAdmin: boolean,
  canManageWorkspace = false,
): NavContext {
  const { workspaceSlug, projectSlug } = parseAppPath(pathname);
  return { workspaceSlug, projectSlug, isAdmin, canManageWorkspace };
}

/** Keep Financials when the rail workspace switcher changes workspace. */
export function workspaceSwitchHref(pathname: string, search: string, slug: string): string {
  const financials = pathname.match(/^\/workspaces\/[^/]+(\/financials\/?.*)$/);
  if (!financials) {
    return `/workspaces/${slug}`;
  }
  const query = search ? (search.startsWith('?') ? search : `?${search}`) : '';
  return `/workspaces/${slug}${financials[1]}${query}`;
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

/** Nested knowledge record opened from inside a project. */
export function isProjectRecordPath(pathname: string): boolean {
  return /^\/workspaces\/[^/]+\/projects\/[^/]+\/records(?:\/|$)/.test(pathname);
}

function projectRecordSlug(pathname: string): string | null {
  const match = pathname.match(/^\/workspaces\/[^/]+\/projects\/[^/]+\/records\/([^/]+)/);
  return match?.[1] ?? null;
}

function navItemById(id: NavItemId, ctx: NavContext): NavItemDef | null {
  for (const section of NAV_SECTIONS) {
    for (const item of section.items) {
      if (item.id === id && isNavItemAvailable(item, ctx)) {
        return item;
      }
    }
  }
  return null;
}

function readSearchParams(search: string): URLSearchParams {
  return new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
}

function hashId(hash: string): string {
  return hash.startsWith('#') ? hash.slice(1) : hash;
}

/** Location args stay so the rail can pass hash and query. Project pages stay in the project menu. */
export function inferNavSection(pathname: string, _hash = '', _search = ''): NavSectionId {
  if (pathname.startsWith('/admin')) {
    return 'admin';
  }
  if (/^\/workspaces\/[^/]+\/financials(\/|$)/.test(pathname)) {
    return 'financials';
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
  if (projectSlug && isProjectRecordPath(pathname)) {
    return 'control';
  }
  if (
    /^\/workspaces\/[^/]+\/(?:archived|imports|document-imports|media|records)(\/|$)/.test(pathname)
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
  if (isProjectRecordPath(pathname)) {
    return item.id === 'project-knowledge';
  }
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
    if (!ctx.workspaceSlug || pathname !== `/workspaces/${ctx.workspaceSlug}`) {
      return false;
    }
    const fragment = hashId(hash);
    return fragment === '' || fragment === WORKSPACE_KNOWLEDGE_ANCHOR;
  }
  if (item.id === 'workspace-systems') {
    return (
      Boolean(ctx.workspaceSlug) &&
      pathname === `/workspaces/${ctx.workspaceSlug}` &&
      hashId(hash) === WORKSPACE_SYSTEMS_ANCHOR
    );
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
  if (item.id === 'admin-financials') {
    return pathname === '/admin/financials' || pathname.startsWith('/admin/financials/');
  }
  if (item.id === 'admin-backups') {
    return pathname.startsWith('/admin/backups') || pathname.startsWith('/admin/storage');
  }
  if (item.id === 'admin-monitoring') {
    return pathname.startsWith('/admin/monitoring');
  }
  if (item.id === 'admin-identity') {
    return (
      pathname.startsWith('/admin/identity')
      || pathname.startsWith('/admin/users')
      || pathname.startsWith('/admin/organizations')
      || pathname.startsWith('/admin/memberships')
      || pathname.startsWith('/admin/sso')
    );
  }
  if (item.id === 'admin-brand') {
    return pathname.startsWith('/admin/brand');
  }
  if (item.id === 'financials-ai-cost') {
    return /^\/workspaces\/[^/]+\/financials(\/|$)/.test(pathname);
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
    return (
      pathMatches && params.get('stakeholders') === 'org' && hashId(hash) === 'project-stakeholders'
    );
  }
  if (hrefParams.get('utilization') === '1') {
    return (
      pathMatches && params.get('utilization') === '1' && hashId(hash) === 'project-stakeholders'
    );
  }
  if (hrefHash) {
    if (
      item.id === 'stakeholders' &&
      (params.get('stakeholders') === 'org' || params.get('utilization') === '1')
    ) {
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
 * One rail id for the pinned or scrolled section.
 * A view query only distinguishes items that share that section
 * (org chart vs stakeholders). Delivery views stay on Delivery.
 */
export function navItemIdForActiveAnchor(activeAnchor: string, search: string): string | null {
  const params = readSearchParams(search);
  const workspaceItem = navItemIdForWorkspaceAnchor(activeAnchor);
  if (workspaceItem) {
    return workspaceItem;
  }
  if (activeAnchor === PROJECT_TOP_ANCHOR || activeAnchor === 'project-overview') {
    return 'overview';
  }
  const section = PROJECT_SECTIONS.find((row) => row.anchor === activeAnchor);
  if (!section) {
    return null;
  }
  if (activeAnchor === 'project-stakeholders') {
    if (params.get('utilization') === '1') {
      return 'utilization';
    }
    if (params.get('stakeholders') === 'org') {
      return 'org';
    }
    return 'stakeholders';
  }
  if (activeAnchor === 'project-delivery') {
    return 'delivery';
  }
  return section.navItemId;
}

function navItemOnPath(item: NavItemDef, ctx: NavContext, pathname: string): boolean {
  const href = hrefParts(item.href(ctx));
  return pathname === href.path || (href.path !== '/' && pathname.startsWith(`${href.path}/`));
}

/**
 * The single highlighted rail item. A pinned or spied anchor wins over the URL.
 * View queries do not select a second item.
 */
export function isRailItemActive(
  item: NavItemDef,
  ctx: NavContext,
  pathname: string,
  hash: string,
  search: string,
  activeAnchor: string | null,
): boolean {
  if (isProjectRecordPath(pathname)) {
    return item.id === 'project-knowledge';
  }
  if (activeAnchor) {
    if (item.id !== navItemIdForActiveAnchor(activeAnchor, search)) {
      return false;
    }
    return navItemOnPath(item, ctx, pathname);
  }
  return matchNavItem(item, ctx, pathname, hash, search);
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

/** Header title and the one rail highlight. The anchor wins over view queries. */
export function resolveActiveNavItem(
  ctx: NavContext,
  pathname: string,
  hash: string,
  search: string,
  activeAnchor: string | null,
): NavItemDef | null {
  if (isProjectRecordPath(pathname)) {
    return navItemById('project-knowledge', ctx);
  }
  const normalizedHash = hash.startsWith('#') ? hash : hash ? `#${hash}` : '';
  const anchor =
    activeAnchor ||
    projectAnchorFromHash(normalizedHash) ||
    workspaceAnchorFromHash(normalizedHash);
  if (anchor) {
    const id = navItemIdForActiveAnchor(anchor, search);
    if (!id) {
      return null;
    }
    for (const section of NAV_SECTIONS) {
      for (const item of section.items) {
        if (item.id !== id || !isNavItemAvailable(item, ctx)) {
          continue;
        }
        if (navItemOnPath(item, ctx, pathname)) {
          return item;
        }
      }
    }
    return null;
  }
  return findActiveNavItem(ctx, pathname, hash, search);
}

export type HeaderCrumb = {
  href: string;
  label: string;
  /** Shell translates this instead of `label`. Used for section names. */
  labelKey?: 'imports' | 'newImport';
};

export function headerCrumbs(
  pathname: string,
  names: {
    workspaceName?: string | null;
    projectName?: string | null;
    recordTitle?: string | null;
    pageTitle?: string | null;
  },
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
  if (workspaceSlug && /^\/workspaces\/[^/]+\/financials(\/|$)/.test(pathname)) {
    crumbs.push({
      href: `/workspaces/${workspaceSlug}/financials`,
      label: names.pageTitle || 'Financials',
    });
    return crumbs;
  }
  const importTrail = workspaceImportCrumbs(pathname, names.pageTitle);
  if (importTrail) {
    crumbs.push(...importTrail);
    return crumbs;
  }
  const recordSlug = projectSlug ? projectRecordSlug(pathname) : null;
  if (projectSlug) {
    const projectHref = `/workspaces/${workspaceSlug}/projects/${projectSlug}`;
    crumbs.push({
      href: recordSlug ? `${projectHref}#project-knowledge` : projectHref,
      label: names.projectName || projectSlug,
    });
  }
  if (workspaceSlug && projectSlug && recordSlug) {
    crumbs.push({
      href: `/workspaces/${workspaceSlug}/projects/${projectSlug}/records/${recordSlug}`,
      label: names.recordTitle || recordSlug,
    });
  }
  if (crumbs.length === 0) {
    crumbs.push({ href: '/workspaces', label: 'Workspaces' });
  }
  return crumbs;
}

/** Workspace / Imports / (new or the open import) for the sticky header. */
function workspaceImportCrumbs(
  pathname: string,
  pageTitle?: string | null,
): HeaderCrumb[] | null {
  const match = pathname.match(
    /^\/workspaces\/([^/]+)\/(imports|document-imports)(?:\/([^/]+))?\/?$/,
  );
  if (!match) return null;
  const workspaceSlug = match[1];
  const area = match[2];
  const segment = match[3];
  const crumbs: HeaderCrumb[] = [
    {
      href: `/workspaces/${workspaceSlug}/imports`,
      label: 'Imports',
      labelKey: 'imports',
    },
  ];
  if (segment === 'new') {
    const href = `/workspaces/${workspaceSlug}/${area}/new`;
    crumbs.push(
      pageTitle
        ? { href, label: pageTitle }
        : { href, label: 'New import', labelKey: 'newImport' },
    );
  } else if (segment) {
    crumbs.push({
      href: `/workspaces/${workspaceSlug}/${area}/${segment}`,
      label: pageTitle || segment,
    });
  }
  return crumbs;
}
