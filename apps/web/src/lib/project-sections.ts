import type { ProjectRagStatus } from './delivery-schedule';
import type { NavIconName, NavItemId } from './ops-nav';

/** In-page target for the Control rail heading (project header). */
export const PROJECT_TOP_ANCHOR = 'project-top';

/** Sticky header offset used when choosing the section in view. */
export const SECTION_MARKER_PX = 96;

export type SectionViewportOffset = {
  id: string;
  /** `getBoundingClientRect().top` relative to the viewport. */
  top: number;
};

/**
 * Section to mark active.
 * A click pin wins until the caller clears it.
 * Otherwise the last section whose top has reached the marker.
 * At the bottom of the page, later short sections never reach that marker,
 * so the last section whose top is still inside the viewport wins instead.
 */
export function pickActiveProjectSection(input: {
  sections: readonly SectionViewportOffset[];
  marker?: number;
  viewportHeight: number;
  atBottom: boolean;
  pinnedAnchor?: string | null;
}): string | null {
  if (input.pinnedAnchor) {
    return input.pinnedAnchor;
  }
  const marker = input.marker ?? SECTION_MARKER_PX;
  if (input.atBottom) {
    let lastVisible: string | null = null;
    for (const section of input.sections) {
      if (section.top < input.viewportHeight) {
        lastVisible = section.id;
      }
    }
    if (lastVisible) {
      return lastVisible;
    }
  }
  let current: string | null = null;
  for (const section of input.sections) {
    if (section.top <= marker) {
      current = section.id;
    }
  }
  return current;
}

/** Header chip that matches the rail's active anchor. Overview also covers the page top. */
export function isHeaderShortcutActive(sectionAnchor: string, activeAnchor: string | null): boolean {
  if (!activeAnchor) {
    return false;
  }
  if (activeAnchor === sectionAnchor) {
    return true;
  }
  return activeAnchor === PROJECT_TOP_ANCHOR && sectionAnchor === 'project-overview';
}

export function isProjectSectionAnchor(id: string): boolean {
  return id === PROJECT_TOP_ANCHOR || PROJECT_SECTIONS.some((section) => section.anchor === id);
}

/** Hash from `hashchange` or `popstate`. Unknown fragments are ignored. */
export function projectAnchorFromHash(hash: string): string | null {
  let id = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!id) {
    return null;
  }
  try {
    id = decodeURIComponent(id);
  } catch {
    return null;
  }
  return isProjectSectionAnchor(id) ? id : null;
}

export type ProjectAnchorClickPlan = {
  anchor: string;
  /**
   * Same page and no explicit query change. The click must be handled in-page.
   * A Next.js `<Link>` would `preventDefault` and `router.push` first, which
   * never fires `hashchange` and never reaches the scroll spy.
   */
  inPage: boolean;
  /** `#project-top` replaces the current entry so Overview does not stack history. */
  history: 'push' | 'replace';
  nextUrl: string;
};

function normalizeSearch(search: string): string {
  if (!search) {
    return '';
  }
  return search.startsWith('?') ? search : `?${search}`;
}

/** View switches. They choose a rail item only for their own section, and a hash-only click drops them. */
const SECTION_VIEW_PARAMS = ['stakeholders', 'utilization', 'delivery'] as const;

export function searchWithoutSectionViews(search: string): string {
  const params = new URLSearchParams(normalizeSearch(search).slice(1));
  for (const key of SECTION_VIEW_PARAMS) {
    params.delete(key);
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

/**
 * Shared plan for a header shortcut (`#anchor`) and a Control rail link
 * (`/projects/:slug#anchor`). Both produce the same anchor for the header.
 */
export function planProjectAnchorClick(input: {
  href: string;
  pathname: string;
  search: string;
}): ProjectAnchorClickPlan | null {
  const href = input.href.trim();
  if (!href) {
    return null;
  }
  const currentSearch = normalizeSearch(input.search);
  let url: URL;
  try {
    url = new URL(href, `https://knowhub.local${input.pathname}${currentSearch}`);
  } catch {
    return null;
  }
  const anchor = projectAnchorFromHash(url.hash);
  if (!anchor || url.pathname !== input.pathname) {
    return null;
  }
  const specifiesSearch = href.includes('?');
  const nextSearch = specifiesSearch ? url.search : searchWithoutSectionViews(currentSearch);
  return {
    anchor,
    inPage: nextSearch === currentSearch,
    history: anchor === PROJECT_TOP_ANCHOR ? 'replace' : 'push',
    nextUrl: `${input.pathname}${nextSearch}#${anchor}`,
  };
}

export const PROJECT_SECTION_STATUS_SOURCES = ['timeline', 'financial', 'risk', 'change'] as const;

export type ProjectSectionStatusSource = (typeof PROJECT_SECTION_STATUS_SOURCES)[number];

/** Rail/header status. `none` is neutral (no budget), not a RAG colour. */
export type ProjectSectionStatusValue = ProjectRagStatus | 'none';

export type ProjectSectionStatuses = Partial<
  Record<ProjectSectionStatusSource, ProjectSectionStatusValue>
>;

export function projectSectionStatusesEqual(
  left: ProjectSectionStatuses,
  right: ProjectSectionStatuses,
): boolean {
  return PROJECT_SECTION_STATUS_SOURCES.every((key) => left[key] === right[key]);
}

/**
 * Project page sections shared by the header shortcuts and the Control rail.
 * `id` / `anchor` match the in-page element id. `labelKey` is under `nav`.
 */
export type ProjectSectionDef = {
  id: string;
  labelKey: string;
  anchor: string;
  icon: NavIconName;
  navItemId: NavItemId;
  statusSource?: ProjectSectionStatusSource;
};

export const PROJECT_SECTIONS: readonly ProjectSectionDef[] = [
  {
    id: 'project-overview',
    labelKey: 'overview',
    anchor: 'project-overview',
    icon: 'overview',
    navItemId: 'overview',
  },
  {
    id: 'project-reports',
    labelKey: 'reports',
    anchor: 'project-reports',
    icon: 'reports',
    navItemId: 'reports',
  },
  {
    id: 'project-baseline',
    labelKey: 'baseline',
    anchor: 'project-baseline',
    icon: 'baseline',
    navItemId: 'baseline',
  },
  {
    id: 'project-stakeholders',
    labelKey: 'stakeholders',
    anchor: 'project-stakeholders',
    icon: 'stakeholders',
    navItemId: 'stakeholders',
  },
  {
    id: 'project-delivery',
    labelKey: 'delivery',
    anchor: 'project-delivery',
    icon: 'delivery',
    navItemId: 'delivery',
    statusSource: 'timeline',
  },
  {
    id: 'project-budget',
    labelKey: 'budget',
    anchor: 'project-budget',
    icon: 'budget',
    navItemId: 'budget',
    statusSource: 'financial',
  },
  {
    id: 'project-raid',
    labelKey: 'raid',
    anchor: 'project-raid',
    icon: 'raid',
    navItemId: 'raid',
    statusSource: 'risk',
  },
  {
    id: 'project-change',
    labelKey: 'changeRequests',
    anchor: 'project-change',
    icon: 'change',
    navItemId: 'change',
    statusSource: 'change',
  },
  {
    id: 'project-systems',
    labelKey: 'systems',
    anchor: 'project-systems',
    icon: 'systems',
    navItemId: 'systems',
  },
  {
    id: 'project-knowledge',
    labelKey: 'projectKnowledge',
    anchor: 'project-knowledge',
    icon: 'knowledgeItem',
    navItemId: 'project-knowledge',
  },
];

export function projectSectionByNavId(navItemId: string): ProjectSectionDef | undefined {
  return PROJECT_SECTIONS.find((section) => section.navItemId === navItemId);
}

/** Smooth in-page scroll unless the user prefers reduced motion. */
export function projectAnchorScrollBehavior(reduceMotion: boolean): ScrollBehavior {
  return reduceMotion ? 'auto' : 'smooth';
}

export function scrollToProjectAnchor(anchorId: string): void {
  if (typeof document === 'undefined') {
    return;
  }
  const target = document.getElementById(anchorId);
  if (!target) {
    return;
  }
  const reduceMotion =
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  target.scrollIntoView({
    behavior: projectAnchorScrollBehavior(reduceMotion),
    block: 'start',
  });
}
