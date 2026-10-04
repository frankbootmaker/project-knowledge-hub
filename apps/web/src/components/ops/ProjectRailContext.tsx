'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  projectSectionStatusesEqual,
  scrollToProjectAnchor,
  type ProjectSectionStatuses,
} from '../../lib/project-sections';

type ProjectRailContextValue = {
  statuses: ProjectSectionStatuses;
  activeAnchor: string | null;
  setStatuses: (statuses: ProjectSectionStatuses) => void;
  setActiveAnchor: (anchor: string | null) => void;
  /** Clicked anchor, kept until the user scrolls on their own. */
  readPinnedAnchor: () => string | null;
  pinAnchor: (anchor: string) => void;
  /** Ignore scroll events from the in-page scroll that follows a click. */
  noteProgrammaticScroll: () => void;
  isProgrammaticScroll: () => boolean;
  /** Pin the anchor and scroll to it once. */
  scrollToPinnedAnchor: (anchor: string) => void;
  /** Drop a click pin. No-op while a programmatic scroll is in progress. */
  releasePinForUserScroll: () => void;
  /** Drop a click pin even during a programmatic scroll (wheel, keys, touch). */
  releasePinForUserIntent: () => void;
};

const ProjectRailContext = createContext<ProjectRailContextValue | null>(null);

const emptyStatuses: ProjectSectionStatuses = {};

export function ProjectRailProvider({ children }: { children: ReactNode }) {
  const [statuses, setStatusesState] = useState<ProjectSectionStatuses>(emptyStatuses);
  const [activeAnchor, setActiveAnchor] = useState<string | null>(null);
  const pinRef = useRef<string | null>(null);
  const programmaticRef = useRef(0);
  const setStatuses = useCallback((next: ProjectSectionStatuses) => {
    setStatusesState((prev) => (projectSectionStatusesEqual(prev, next) ? prev : next));
  }, []);
  const readPinnedAnchor = useCallback(() => pinRef.current, []);
  const pinAnchor = useCallback((anchor: string) => {
    pinRef.current = anchor;
    setActiveAnchor(anchor);
  }, []);
  const noteProgrammaticScroll = useCallback(() => {
    programmaticRef.current += 1;
    let released = false;
    const done = () => {
      if (released) {
        return;
      }
      released = true;
      programmaticRef.current = Math.max(0, programmaticRef.current - 1);
    };
    window.addEventListener('scrollend', done, { once: true });
    window.setTimeout(done, 900);
  }, []);
  const isProgrammaticScroll = useCallback(() => programmaticRef.current > 0, []);
  const scrollToPinnedAnchor = useCallback(
    (anchor: string) => {
      pinAnchor(anchor);
      noteProgrammaticScroll();
      scrollToProjectAnchor(anchor);
    },
    [noteProgrammaticScroll, pinAnchor],
  );
  const releasePinForUserScroll = useCallback(() => {
    if (programmaticRef.current > 0) {
      return;
    }
    pinRef.current = null;
  }, []);
  const releasePinForUserIntent = useCallback(() => {
    programmaticRef.current = 0;
    pinRef.current = null;
  }, []);
  const value = useMemo(
    () => ({
      statuses,
      activeAnchor,
      setStatuses,
      setActiveAnchor,
      readPinnedAnchor,
      pinAnchor,
      noteProgrammaticScroll,
      isProgrammaticScroll,
      scrollToPinnedAnchor,
      releasePinForUserScroll,
      releasePinForUserIntent,
    }),
    [
      statuses,
      activeAnchor,
      setStatuses,
      readPinnedAnchor,
      pinAnchor,
      noteProgrammaticScroll,
      isProgrammaticScroll,
      scrollToPinnedAnchor,
      releasePinForUserScroll,
      releasePinForUserIntent,
    ],
  );

  return <ProjectRailContext.Provider value={value}>{children}</ProjectRailContext.Provider>;
}

export function useProjectRail(): ProjectRailContextValue {
  const value = useContext(ProjectRailContext);
  if (value) {
    return value;
  }
  return {
    statuses: emptyStatuses,
    activeAnchor: null,
    setStatuses: () => {},
    setActiveAnchor: () => {},
    readPinnedAnchor: () => null,
    pinAnchor: () => {},
    noteProgrammaticScroll: () => {},
    isProgrammaticScroll: () => false,
    scrollToPinnedAnchor: () => {},
    releasePinForUserScroll: () => {},
    releasePinForUserIntent: () => {},
  };
}
