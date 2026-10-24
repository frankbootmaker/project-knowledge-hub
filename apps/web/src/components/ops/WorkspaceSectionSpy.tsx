'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import {
  isWorkspaceCataloguePath,
  pickActiveWorkspaceSection,
  scrollToWorkspaceAnchor,
  workspaceAnchorFromHash,
} from '../../lib/workspace-sections';
import { useFollowProjectAnchor } from './followProjectAnchor';
import { useProjectRail } from './ProjectRailContext';

function isPageBottom(): boolean {
  const root = document.documentElement;
  return root.scrollHeight - window.scrollY - window.innerHeight <= 2;
}

/** Tracks workspace catalogue sections for the Documents rail. */
export function WorkspaceSectionSpy() {
  const pathname = usePathname();
  const {
    setActiveAnchor,
    readPinnedAnchor,
    pinAnchor,
    noteProgrammaticScroll,
    isProgrammaticScroll,
    releasePinForUserScroll,
    releasePinForUserIntent,
  } = useProjectRail();
  const followProjectAnchor = useFollowProjectAnchor();

  useEffect(() => {
    if (!isWorkspaceCataloguePath(pathname)) {
      return;
    }

    function pick() {
      const next = pickActiveWorkspaceSection({
        viewportHeight: window.innerHeight,
        atBottom: isPageBottom(),
        pinnedAnchor: readPinnedAnchor(),
      });
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

    const hash = workspaceAnchorFromHash(window.location.hash);
    let mountFrame = 0;
    if (hash) {
      pinAnchor(hash);
      noteProgrammaticScroll();
      mountFrame = window.requestAnimationFrame(() => {
        scrollToWorkspaceAnchor(hash);
      });
    }

    function onLocationAnchor(nextHash: string) {
      const next = workspaceAnchorFromHash(nextHash);
      if (!next) {
        releasePinForUserIntent();
        schedule();
        return;
      }
      if (readPinnedAnchor() === next) {
        return;
      }
      pinAnchor(next);
      noteProgrammaticScroll();
      scrollToWorkspaceAnchor(next);
    }

    function onHashOrPop() {
      onLocationAnchor(window.location.hash);
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
      const href = target.closest('a[href]')?.getAttribute('href');
      if (!href) {
        return;
      }
      followProjectAnchor(href, event);
    }

    schedule();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', schedule);
    window.addEventListener('wheel', onUserIntent, { passive: true });
    window.addEventListener('touchmove', onUserIntent, { passive: true });
    window.addEventListener('keydown', onKey);
    window.addEventListener('hashchange', onHashOrPop);
    window.addEventListener('popstate', onHashOrPop);
    document.addEventListener('click', onAnchorClick);
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      window.cancelAnimationFrame(frame);
      window.cancelAnimationFrame(mountFrame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('wheel', onUserIntent);
      window.removeEventListener('touchmove', onUserIntent);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('hashchange', onHashOrPop);
      window.removeEventListener('popstate', onHashOrPop);
      document.removeEventListener('click', onAnchorClick);
      observer.disconnect();
      setActiveAnchor(null);
    };
  }, [
    pathname,
    followProjectAnchor,
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
