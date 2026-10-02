import { describe, expect, it } from 'vitest';
import de from '../../messages/de.json';
import en from '../../messages/en.json';
import hu from '../../messages/hu.json';
import {
  PROJECT_SECTIONS,
  PROJECT_TOP_ANCHOR,
  projectAnchorScrollBehavior,
  projectSectionByNavId,
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
});
