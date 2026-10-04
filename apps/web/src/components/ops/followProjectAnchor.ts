'use client';

import { useCallback } from 'react';
import { planProjectAnchorClick } from '../../lib/project-sections';
import { useProjectRail } from './ProjectRailContext';

/**
 * Header shortcuts and Control rail links both call this.
 * Hash-only clicks are taken over so Next.js `<Link>` cannot swallow them.
 */
export function useFollowProjectAnchor() {
  const { scrollToPinnedAnchor, pinAnchor, noteProgrammaticScroll } = useProjectRail();

  return useCallback(
    (href: string, event?: { preventDefault(): void }) => {
      const plan = planProjectAnchorClick({
        href,
        pathname: window.location.pathname,
        search: window.location.search,
      });
      if (!plan) {
        return false;
      }
      if (!plan.inPage) {
        pinAnchor(plan.anchor);
        noteProgrammaticScroll();
        return false;
      }
      event?.preventDefault();
      scrollToPinnedAnchor(plan.anchor);
      const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (current !== plan.nextUrl) {
        if (plan.history === 'replace') {
          window.history.replaceState(null, '', plan.nextUrl);
        } else {
          window.history.pushState(null, '', plan.nextUrl);
        }
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      }
      return true;
    },
    [noteProgrammaticScroll, pinAnchor, scrollToPinnedAnchor],
  );
}
