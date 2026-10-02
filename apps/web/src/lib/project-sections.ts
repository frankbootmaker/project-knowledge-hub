import type { ProjectRagStatus } from './delivery-schedule';
import type { NavIconName, NavItemId } from './ops-nav';

/** In-page target for the Control rail heading (project header). */
export const PROJECT_TOP_ANCHOR = 'project-top';

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
