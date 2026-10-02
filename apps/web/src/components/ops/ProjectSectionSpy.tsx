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

/**
 * Publishes project RAG for the rail and tracks the visible section.
 * One IntersectionObserver; disconnected when the project page unmounts.
 */
export function ProjectSectionSpy({ statuses }: { statuses: ProjectSectionStatuses }) {
  const pathname = usePathname();
  const { setStatuses, setActiveAnchor } = useProjectRail();

  useEffect(() => {
    setStatuses(statuses);
    return () => {
      setStatuses({});
    };
  }, [statuses, setStatuses]);

  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, '');
    let frame = 0;
    if (hash === PROJECT_TOP_ANCHOR) {
      frame = window.requestAnimationFrame(() => {
        scrollToProjectAnchor(PROJECT_TOP_ANCHOR);
      });
    } else if (PROJECT_SECTIONS.some((section) => section.anchor === hash)) {
      setActiveAnchor(hash);
    }

    function onHash() {
      const next = window.location.hash.replace(/^#/, '');
      if (next === PROJECT_TOP_ANCHOR) {
        scrollToProjectAnchor(PROJECT_TOP_ANCHOR);
        return;
      }
      if (PROJECT_SECTIONS.some((section) => section.anchor === next)) {
        setActiveAnchor(next);
      }
    }

    window.addEventListener('hashchange', onHash);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('hashchange', onHash);
    };
  }, [pathname, setActiveAnchor]);

  useEffect(() => {
    const elements = PROJECT_SECTIONS.map((section) =>
      document.getElementById(section.anchor),
    ).filter((node): node is HTMLElement => node != null);
    if (elements.length === 0) {
      return;
    }

    const visible = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            visible.set(entry.target.id, entry.boundingClientRect.top);
          } else {
            visible.delete(entry.target.id);
          }
        }
        let best: string | null = null;
        let bestDistance = Infinity;
        for (const [id, top] of visible) {
          const distance = Math.abs(top - 88);
          if (distance < bestDistance) {
            bestDistance = distance;
            best = id;
          }
        }
        if (best) {
          setActiveAnchor(best);
        }
      },
      {
        root: null,
        rootMargin: '-72px 0px -40% 0px',
        threshold: [0, 0.15, 0.4, 0.75],
      },
    );

    for (const element of elements) {
      observer.observe(element);
    }
    return () => {
      observer.disconnect();
      setActiveAnchor(null);
    };
  }, [pathname, setActiveAnchor]);

  return null;
}
