import {
  defaultNavSection,
  isNavSectionId,
  type NavSectionId,
} from './ops-nav';

export const navSectionStorageKey = 'kh-nav-section';
export const railCompactStorageKey = 'kh-rail-compact';
export const lastWorkspaceStorageKey = 'kh-last-workspace';
export const lastProjectStorageKey = 'kh-last-project';

export type LastProjectPref = {
  workspaceSlug: string;
  projectSlug: string;
  workspaceName?: string;
  projectName?: string;
};

export function readNavSection(): NavSectionId {
  if (typeof window === 'undefined') {
    return defaultNavSection;
  }
  try {
    return isNavSectionId(localStorage.getItem(navSectionStorageKey))
      ? (localStorage.getItem(navSectionStorageKey) as NavSectionId)
      : defaultNavSection;
  } catch {
    return defaultNavSection;
  }
}

export function writeNavSection(section: NavSectionId): void {
  try {
    localStorage.setItem(navSectionStorageKey, section);
  } catch {
    // Ignore quota / private mode.
  }
}

export function readRailCompact(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  try {
    return localStorage.getItem(railCompactStorageKey) === '1';
  } catch {
    return false;
  }
}

export function writeRailCompact(compact: boolean): void {
  try {
    localStorage.setItem(railCompactStorageKey, compact ? '1' : '0');
  } catch {
    // Ignore quota / private mode.
  }
}

export function readLastWorkspace(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return localStorage.getItem(lastWorkspaceStorageKey);
  } catch {
    return null;
  }
}

export function writeLastWorkspace(slug: string): void {
  try {
    localStorage.setItem(lastWorkspaceStorageKey, slug);
  } catch {
    // Ignore quota / private mode.
  }
}

export function readLastProject(): LastProjectPref | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const raw = localStorage.getItem(lastProjectStorageKey);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as LastProjectPref;
    if (!parsed.workspaceSlug || !parsed.projectSlug) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeLastProject(pref: LastProjectPref): void {
  try {
    localStorage.setItem(lastProjectStorageKey, JSON.stringify(pref));
    localStorage.setItem(lastWorkspaceStorageKey, pref.workspaceSlug);
  } catch {
    // Ignore quota / private mode.
  }
}
