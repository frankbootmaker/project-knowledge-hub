import { SECTION_MARKER_PX, pickActiveProjectSection, scrollToProjectAnchor } from './project-sections';

export const WORKSPACE_KNOWLEDGE_ANCHOR = 'workspace-knowledge';
export const WORKSPACE_SYSTEMS_ANCHOR = 'workspace-systems';

export const WORKSPACE_SCROLL_SECTIONS = [
  { anchor: WORKSPACE_SYSTEMS_ANCHOR, navItemId: 'workspace-systems' },
  { anchor: WORKSPACE_KNOWLEDGE_ANCHOR, navItemId: 'knowledge' },
] as const;

/** Workspace catalogue index: `/workspaces/:slug` only. */
export function isWorkspaceCataloguePath(pathname: string): boolean {
  return /^\/workspaces\/[^/]+$/.test(pathname);
}

const WORKSPACE_ANCHORS = new Set<string>([
  WORKSPACE_KNOWLEDGE_ANCHOR,
  WORKSPACE_SYSTEMS_ANCHOR,
]);

export function isWorkspaceSectionAnchor(id: string): boolean {
  return WORKSPACE_ANCHORS.has(id);
}

export function workspaceAnchorFromHash(hash: string): string | null {
  let id = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!id) {
    return null;
  }
  try {
    id = decodeURIComponent(id);
  } catch {
    return null;
  }
  return isWorkspaceSectionAnchor(id) ? id : null;
}

export type WorkspaceAnchorClickPlan = {
  anchor: string;
  inPage: boolean;
  history: 'push' | 'replace';
  nextUrl: string;
};

export function planWorkspaceAnchorClick(input: {
  href: string;
  pathname: string;
  search: string;
}): WorkspaceAnchorClickPlan | null {
  if (!isWorkspaceCataloguePath(input.pathname)) {
    return null;
  }
  const href = input.href.trim();
  if (!href) {
    return null;
  }
  const search = input.search.startsWith('?') ? input.search : input.search ? `?${input.search}` : '';
  let url: URL;
  try {
    url = new URL(href, `https://knowhub.local${input.pathname}${search}`);
  } catch {
    return null;
  }
  const anchor = workspaceAnchorFromHash(url.hash);
  if (!anchor || url.pathname !== input.pathname) {
    return null;
  }
  const nextSearch = url.search || '';
  return {
    anchor,
    inPage: nextSearch === search,
    history: 'push',
    nextUrl: `${input.pathname}${nextSearch}#${anchor}`,
  };
}

export function navItemIdForWorkspaceAnchor(anchor: string): string | null {
  if (anchor === WORKSPACE_KNOWLEDGE_ANCHOR) {
    return 'knowledge';
  }
  if (anchor === WORKSPACE_SYSTEMS_ANCHOR) {
    return 'workspace-systems';
  }
  return null;
}

export function measureWorkspaceSections(): Array<{ id: string; top: number }> {
  const sections: Array<{ id: string; top: number }> = [];
  for (const section of WORKSPACE_SCROLL_SECTIONS) {
    const element = document.getElementById(section.anchor);
    if (!element) {
      continue;
    }
    sections.push({ id: section.anchor, top: element.getBoundingClientRect().top });
  }
  return sections;
}

export function pickActiveWorkspaceSection(input: {
  pinnedAnchor?: string | null;
  viewportHeight: number;
  atBottom: boolean;
}): string | null {
  const picked = pickActiveProjectSection({
    sections: measureWorkspaceSections(),
    marker: SECTION_MARKER_PX,
    viewportHeight: input.viewportHeight,
    atBottom: input.atBottom,
    pinnedAnchor: input.pinnedAnchor,
  });
  return picked ?? WORKSPACE_KNOWLEDGE_ANCHOR;
}

export function scrollToWorkspaceAnchor(anchorId: string): void {
  scrollToProjectAnchor(anchorId);
}
