import { describe, expect, it } from 'vitest';
import de from '../../messages/de.json';
import en from '../../messages/en.json';
import hu from '../../messages/hu.json';
import {
  PROJECT_SECTIONS,
  PROJECT_TOP_ANCHOR,
  isHeaderShortcutActive,
  pickActiveProjectSection,
  projectAnchorScrollBehavior,
  projectSectionByNavId,
  type SectionViewportOffset,
} from './project-sections';

const catalogs = [en, de, hu];

function navLabel(catalog: { nav: Record<string, string> }, key: string): string | undefined {
  return catalog.nav[key];
}

describe('project sections', () => {
  it('uses one anchor per section and a distinct project-top target', () => {
    const anchors = PROJECT_SECTIONS.map((section) => section.anchor);
    expect(new Set(anchors).size).toBe(anchors.length);
    expect(PROJECT_SECTIONS.every((section) => section.id === section.anchor)).toBe(true);
    expect(anchors).not.toContain(PROJECT_TOP_ANCHOR);
    expect(PROJECT_TOP_ANCHOR).toBe('project-top');
  });

  it('marks delivery, budget, RAID, and change with a status source', () => {
    expect(
      PROJECT_SECTIONS.filter((section) => section.statusSource).map((section) => [
        section.navItemId,
        section.statusSource,
      ]),
    ).toEqual([
      ['delivery', 'timeline'],
      ['budget', 'financial'],
      ['raid', 'risk'],
      ['change', 'change'],
    ]);
    expect(projectSectionByNavId('change')?.anchor).toBe('project-change');
    expect(projectSectionByNavId('utilization')).toBeUndefined();
  });

  it('has a nav label in every locale', () => {
    const keys = [...PROJECT_SECTIONS.map((section) => section.labelKey), 'goToProjectTop'];
    for (const catalog of catalogs) {
      for (const key of keys) {
        expect(navLabel(catalog, key)).toBeTruthy();
      }
    }
  });

  it('scrolls smoothly unless reduced motion is requested', () => {
    expect(projectAnchorScrollBehavior(false)).toBe('smooth');
    expect(projectAnchorScrollBehavior(true)).toBe('auto');
  });

  it('picks the section at the marker, and the last visible section at the bottom', () => {
    const sections: SectionViewportOffset[] = [
      { id: 'project-delivery', top: -480 },
      { id: 'project-budget', top: -220 },
      { id: 'project-raid', top: 40 },
      { id: 'project-change', top: 320 },
      { id: 'project-systems', top: 540 },
      { id: 'project-knowledge', top: 760 },
    ];
    expect(
      pickActiveProjectSection({
        sections,
        viewportHeight: 800,
        atBottom: false,
      }),
    ).toBe('project-raid');
    expect(
      pickActiveProjectSection({
        sections,
        viewportHeight: 800,
        atBottom: true,
      }),
    ).toBe('project-knowledge');
    expect(
      pickActiveProjectSection({
        sections: sections.map((section) =>
          section.id === 'project-knowledge' ? { ...section, top: 940 } : section,
        ),
        viewportHeight: 800,
        atBottom: true,
      }),
    ).toBe('project-systems');
    expect(
      pickActiveProjectSection({
        sections,
        viewportHeight: 800,
        atBottom: true,
        pinnedAnchor: 'project-change',
      }),
    ).toBe('project-change');
    expect(
      pickActiveProjectSection({
        sections,
        viewportHeight: 800,
        atBottom: false,
        pinnedAnchor: 'project-budget',
      }),
    ).toBe('project-budget');
    expect(
      pickActiveProjectSection({
        sections: [{ id: 'project-overview', top: 240 }],
        viewportHeight: 800,
        atBottom: false,
      }),
    ).toBeNull();
  });

  it('highlights the same header chip as the active rail anchor', () => {
    expect(isHeaderShortcutActive('project-delivery', 'project-delivery')).toBe(true);
    expect(isHeaderShortcutActive('project-raid', 'project-delivery')).toBe(false);
    expect(isHeaderShortcutActive('project-systems', 'project-systems')).toBe(true);
    expect(isHeaderShortcutActive('project-overview', 'project-top')).toBe(true);
    expect(isHeaderShortcutActive('project-delivery', 'project-top')).toBe(false);
    expect(isHeaderShortcutActive('project-overview', null)).toBe(false);
  });
});
