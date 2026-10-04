'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import {
  PROJECT_SECTIONS,
  PROJECT_TOP_ANCHOR,
  SECTION_MARKER_PX,
  pickActiveProjectSection,
  scrollToProjectAnchor,
  type ProjectSectionStatuses,
  type SectionViewportOffset,
} from '../../lib/project-sections';
import { useProjectRail } from './ProjectRailContext';

function isProjectAnchor(id: string): boolean {
  return id === PROJECT_TOP_ANCHOR || PROJECT_SECTIONS.some((section) => section.anchor === id);
}

function hashFromHref(href: string): string | null {
  const hashIndex = href.indexOf('#');
  if (hashIndex < 0) {
    return null;
  }
  const id = href.slice(hashIndex + 1);
  return id || null;
}

function measureSections(): SectionViewportOffset[] {
  const sections: SectionViewportOffset[] = [];
  for (const section of PROJECT_SECTIONS) {
    const element = document.getElementById(section.anchor);
    if (!element) {
      continue;
    }
    sections.push({ id: section.anchor, top: element.getBoundingClientRect().top });
  }
  return sections;
}

function isPageBottom(): boolean {
  const root = document.documentElement;
  return root.scrollHeight - window.scrollY - window.innerHeight <= 2;
}

/**
 * Publishes project status for the rail and tracks the visible section.
 * A clicked anchor stays active until the user scrolls. Positions are read
 * on scroll so tall sections stay current, including sections that mount later.
 */
export function ProjectSectionSpy({ statuses }: { statuses: ProjectSectionStatuses }) {
  const pathname = usePathname();
  const {
    setStatuses,
    setActiveAnchor,
    readPinnedAnchor,
    pinAnchor,
    noteProgrammaticScroll,
    isProgrammaticScroll,
    releasePinForUserScroll,
    releasePinForUserIntent,
  } = useProjectRail();

  useEffect(() => {
    setStatuses(statuses);
  }, [statuses, setStatuses]);

  useEffect(() => {
    return () => {
      setStatuses({});
    };
  }, [setStatuses]);

  useEffect(() => {
    function pick() {
      const next =
        pickActiveProjectSection({
          sections: measureSections(),
          marker: SECTION_MARKER_PX,
          viewportHeight: window.innerHeight,
          atBottom: isPageBottom(),
          pinnedAnchor: readPinnedAnchor(),
        }) ?? PROJECT_TOP_ANCHOR;
      setActiveAnchor(next);
    }

    let frame = 0;
    function schedule() {
      if (frame) {
        return;
      }
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        pick();
      });
    }

    function onScroll() {
      if (isProgrammaticScroll()) {
        return;
      }
      releasePinForUserScroll();
      schedule();
    }

    function onUserIntent() {
      releasePinForUserIntent();
      schedule();
    }

    function onKey(event: KeyboardEvent) {
      const keys = new Set(['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' ']);
      if (!keys.has(event.key)) {
        return;
      }
      const target = event.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) {
          return;
        }
      }
      onUserIntent();
    }

    const hash = window.location.hash.replace(/^#/, '');
    let mountFrame = 0;
    if (isProjectAnchor(hash)) {
      pinAnchor(hash);
      noteProgrammaticScroll();
      mountFrame = window.requestAnimationFrame(() => {
        scrollToProjectAnchor(hash);
      });
    }

    function onHash() {
      const next = window.location.hash.replace(/^#/, '');
      if (!isProjectAnchor(next) || readPinnedAnchor() === next) {
        return;
      }
      pinAnchor(next);
      noteProgrammaticScroll();
    }

    function onAnchorClick(event: MouseEvent) {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      const link = target.closest('a[href]');
      const href = link?.getAttribute('href');
      if (!href) {
        return;
      }
      const id = hashFromHref(href);
      if (!id || !isProjectAnchor(id) || !document.getElementById(id)) {
        return;
      }
      let url: URL;
      try {
        url = new URL(href, window.location.href);
      } catch {
        return;
      }
      if (url.pathname !== window.location.pathname) {
        return;
      }
      pinAnchor(id);
      noteProgrammaticScroll();
      if (!href.startsWith('#')) {
        return;
      }
      event.preventDefault();
      scrollToProjectAnchor(id);
      const nextUrl = `${window.location.pathname}${window.location.search}#${id}`;
      const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (current !== nextUrl) {
        window.history.pushState(null, '', nextUrl);
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      }
    }

    schedule();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', schedule);
    window.addEventListener('wheel', onUserIntent, { passive: true });
    window.addEventListener('touchmove', onUserIntent, { passive: true });
    window.addEventListener('keydown', onKey);
    window.addEventListener('hashchange', onHash);
    document.addEventListener('click', onAnchorClick);
    const observer = new MutationObserver(schedule);
    const pageRoot = document.getElementById(PROJECT_TOP_ANCHOR)?.parentElement;
    if (pageRoot) {
      observer.observe(pageRoot, { childList: true, subtree: true });
    }

    return () => {
      window.cancelAnimationFrame(frame);
      window.cancelAnimationFrame(mountFrame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('wheel', onUserIntent);
      window.removeEventListener('touchmove', onUserIntent);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('hashchange', onHash);
      document.removeEventListener('click', onAnchorClick);
      observer.disconnect();
      setActiveAnchor(null);
    };
  }, [
    pathname,
    isProgrammaticScroll,
    noteProgrammaticScroll,
    pinAnchor,
    readPinnedAnchor,
    releasePinForUserIntent,
    releasePinForUserScroll,
    setActiveAnchor,
  ]);

  return null;
}
