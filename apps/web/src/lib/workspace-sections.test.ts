import { describe, expect, it } from 'vitest';
import de from '../../messages/de.json';
import en from '../../messages/en.json';
import hu from '../../messages/hu.json';
import {
  WORKSPACE_KNOWLEDGE_ANCHOR,
  WORKSPACE_SYSTEMS_ANCHOR,
  isWorkspaceCataloguePath,
  navItemIdForWorkspaceAnchor,
  planWorkspaceAnchorClick,
  workspaceAnchorFromHash,
} from './workspace-sections';
import { matchNavItem, NAV_SECTIONS } from './ops-nav';

const ctx = {
  workspaceSlug: 'platform',
  projectSlug: null,
  isAdmin: false,
};

describe('workspace sections (PRO-T-131)', () => {
  it('uses localized Documents section title and keeps the Knowledge item label', () => {
    expect(en.nav.sectionKnowledge).toBe('Documents');
    expect(hu.nav.sectionKnowledge).toBe('Dokumentumok');
    expect(de.nav.sectionKnowledge).toBe('Dokumente');
    expect(en.nav.knowledgeLibrary).toBe('Knowledge');
    expect(hu.nav.knowledgeLibrary).toBe('Tudás');
    expect(de.nav.knowledgeLibrary).toBe('Wissen');
    expect(en.nav.workspaceSystems).toBe('Systems');
    expect(hu.nav.workspaceSystems).toBe('Rendszerek');
    expect(de.nav.workspaceSystems).toBe('Systeme');
  });

  it('parses workspace catalogue anchors from the hash', () => {
    expect(workspaceAnchorFromHash('#workspace-knowledge')).toBe(WORKSPACE_KNOWLEDGE_ANCHOR);
    expect(workspaceAnchorFromHash('workspace-systems')).toBe(WORKSPACE_SYSTEMS_ANCHOR);
    expect(workspaceAnchorFromHash('#project-top')).toBeNull();
  });

  it('plans in-page and cross-page workspace anchor navigation', () => {
    const path = '/workspaces/platform';
    const knowledge = NAV_SECTIONS.flatMap((section) => section.items).find(
      (item) => item.id === 'knowledge',
    )!;
    const systems = NAV_SECTIONS.flatMap((section) => section.items).find(
      (item) => item.id === 'workspace-systems',
    )!;
    expect(knowledge.href(ctx)).toBe(`${path}#${WORKSPACE_KNOWLEDGE_ANCHOR}`);
    expect(systems.href(ctx)).toBe(`${path}#${WORKSPACE_SYSTEMS_ANCHOR}`);

    const inPage = planWorkspaceAnchorClick({
      href: systems.href(ctx),
      pathname: path,
      search: '',
    });
    expect(inPage?.inPage).toBe(true);
    expect(inPage?.nextUrl).toBe(`${path}#${WORKSPACE_SYSTEMS_ANCHOR}`);

    const crossPage = planWorkspaceAnchorClick({
      href: knowledge.href(ctx),
      pathname: '/workspaces/platform/media',
      search: '',
    });
    expect(crossPage).toBeNull();

    expect(isWorkspaceCataloguePath(path)).toBe(true);
    expect(isWorkspaceCataloguePath('/workspaces/platform/media')).toBe(false);
  });

  it('highlights the matching rail item from the hash and scroll spy anchor', () => {
    const path = '/workspaces/platform';
    const knowledge = NAV_SECTIONS.flatMap((section) => section.items).find(
      (item) => item.id === 'knowledge',
    )!;
    const systems = NAV_SECTIONS.flatMap((section) => section.items).find(
      (item) => item.id === 'workspace-systems',
    )!;
    expect(matchNavItem(knowledge, ctx, path, WORKSPACE_KNOWLEDGE_ANCHOR, '')).toBe(true);
    expect(matchNavItem(systems, ctx, path, WORKSPACE_SYSTEMS_ANCHOR, '')).toBe(true);
    expect(matchNavItem(knowledge, ctx, path, WORKSPACE_SYSTEMS_ANCHOR, '')).toBe(false);
    expect(navItemIdForWorkspaceAnchor(WORKSPACE_SYSTEMS_ANCHOR)).toBe('workspace-systems');
    expect(navItemIdForWorkspaceAnchor(WORKSPACE_KNOWLEDGE_ANCHOR)).toBe('knowledge');
  });
});
