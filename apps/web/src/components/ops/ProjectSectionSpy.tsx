'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import {
  PROJECT_SECTIONS,
  PROJECT_TOP_ANCHOR,
  scrollToProjectAnchor,
  type ProjectSectionStatuses,
} from '../../lib/project-sections';
import { useProjectRail } from './ProjectRailContext';

const SECTION_MARKER_PX = 96;

function isProjectAnchor(id: string): boolean {
  return (
    id === PROJECT_TOP_ANCHOR || PROJECT_SECTIONS.some((section) => section.anchor === id)
  );
}

/** Last section whose top has reached the sticky header. Re-reads layout each pass. */
function currentSectionAnchor(): string | null {
  let current: string | null = null;
  for (const section of PROJECT_SECTIONS) {
    const element = document.getElementById(section.anchor);
    if (!element) {
      continue;
    }
    if (element.getBoundingClientRect().top <= SECTION_MARKER_PX) {
      current = section.anchor;
    }
  }
  return current;
}

/**
 * Publishes project status for the rail and tracks the visible section.
 * Positions are read on scroll (rAF) so tall sections stay current, and a
 * MutationObserver picks up sections that mount after the first pass.
 */
export function ProjectSectionSpy({ statuses }: { statuses: ProjectSectionStatuses }) {
  const pathname = usePathname();
  const { setStatuses, setActiveAnchor } = useProjectRail();

  useEffect(() => {
    setStatuses(statuses);
  }, [statuses, setStatuses]);

  useEffect(() => {
    return () => {
      setStatuses({});
    };
  }, [setStatuses]);

  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, '');
    let frame = 0;
    if (isProjectAnchor(hash)) {
      if (hash !== PROJECT_TOP_ANCHOR) {
        setActiveAnchor(hash);
      }
      frame = window.requestAnimationFrame(() => {
        scrollToProjectAnchor(hash);
      });
    }

    function onHash() {
      const next = window.location.hash.replace(/^#/, '');
      if (!isProjectAnchor(next) || next === PROJECT_TOP_ANCHOR) {
        return;
      }
      setActiveAnchor(next);
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
      if (!href?.startsWith('#')) {
        return;
      }
      const id = href.slice(1);
      if (!isProjectAnchor(id) || !document.getElementById(id)) {
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
      if (id !== PROJECT_TOP_ANCHOR) {
        setActiveAnchor(id);
      }
    }

    window.addEventListener('hashchange', onHash);
    document.addEventListener('click', onAnchorClick);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('hashchange', onHash);
      document.removeEventListener('click', onAnchorClick);
    };
  }, [pathname, setActiveAnchor]);

  useEffect(() => {
    let frame = 0;

    function pick() {
      const next = currentSectionAnchor();
      setActiveAnchor(next);
    }

    function schedule() {
      if (frame) {
        return;
      }
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        pick();
      });
    }

    schedule();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      observer.disconnect();
      setActiveAnchor(null);
    };
  }, [pathname, setActiveAnchor]);

  return null;
}
