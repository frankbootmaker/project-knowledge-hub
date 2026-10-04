'use client';

import { useRouter } from 'next/navigation';
import { useCallback } from 'react';
import { planProjectAnchorClick, scrollToProjectAnchor } from '../../lib/project-sections';
import { useProjectRail } from './ProjectRailContext';

/**
 * Header shortcuts and Control rail links both call this.
 * A hash-only click is taken over so Next.js `<Link>` cannot swallow the pin.
 * Dropping a section view query goes through the router so the page state updates.
 */
export function useFollowProjectAnchor() {
  const router = useRouter();
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
      event?.preventDefault();
      if (!plan.inPage) {
        pinAnchor(plan.anchor);
        noteProgrammaticScroll();
        const navigate = plan.history === 'replace' ? router.replace : router.push;
        navigate(plan.nextUrl, { scroll: false });
        scrollToProjectAnchor(plan.anchor);
        return true;
      }
      scrollToPinnedAnchor(plan.anchor);
      const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (current !== plan.nextUrl) {
        const state = window.history.state;
        if (plan.history === 'replace') {
          window.history.replaceState(state, '', plan.nextUrl);
        } else {
          window.history.pushState(state, '', plan.nextUrl);
        }
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      }
      return true;
    },
    [noteProgrammaticScroll, pinAnchor, router, scrollToPinnedAnchor],
  );
}
