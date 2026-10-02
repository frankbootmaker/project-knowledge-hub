'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import {
  projectSectionStatusesEqual,
  type ProjectSectionStatuses,
} from '../../lib/project-sections';

type ProjectRailContextValue = {
  statuses: ProjectSectionStatuses;
  activeAnchor: string | null;
  setStatuses: (statuses: ProjectSectionStatuses) => void;
  setActiveAnchor: (anchor: string | null) => void;
};

const ProjectRailContext = createContext<ProjectRailContextValue | null>(null);

const emptyStatuses: ProjectSectionStatuses = {};

export function ProjectRailProvider({ children }: { children: ReactNode }) {
  const [statuses, setStatusesState] = useState<ProjectSectionStatuses>(emptyStatuses);
  const [activeAnchor, setActiveAnchor] = useState<string | null>(null);
  const setStatuses = useCallback((next: ProjectSectionStatuses) => {
    setStatusesState((prev) => (projectSectionStatusesEqual(prev, next) ? prev : next));
  }, []);
  const value = useMemo(
    () => ({
      statuses,
      activeAnchor,
      setStatuses,
      setActiveAnchor,
    }),
    [statuses, activeAnchor, setStatuses],
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
  };
}
