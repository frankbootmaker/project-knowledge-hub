'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export type ShellCrumbLabels = {
  projectName: string | null;
  recordTitle: string | null;
};

type ShellCrumbActions = {
  publish: (labels: ShellCrumbLabels) => number;
  clear: (token: number) => void;
};

const emptyLabels: ShellCrumbLabels = {
  projectName: null,
  recordTitle: null,
};

const LabelsContext = createContext<ShellCrumbLabels>(emptyLabels);
const ActionsContext = createContext<ShellCrumbActions | null>(null);

export function ShellCrumbProvider({ children }: { children: ReactNode }) {
  const [labels, setLabels] = useState<ShellCrumbLabels>(emptyLabels);
  const tokenRef = useRef(0);
  const activeRef = useRef(0);

  const publish = useCallback((next: ShellCrumbLabels) => {
    tokenRef.current += 1;
    const token = tokenRef.current;
    activeRef.current = token;
    setLabels(next);
    return token;
  }, []);

  const clear = useCallback((token: number) => {
    if (activeRef.current !== token) {
      return;
    }
    activeRef.current = 0;
    setLabels(emptyLabels);
  }, []);

  const actions = useMemo(() => ({ publish, clear }), [publish, clear]);

  return (
    <ActionsContext.Provider value={actions}>
      <LabelsContext.Provider value={labels}>{children}</LabelsContext.Provider>
    </ActionsContext.Provider>
  );
}

export function useShellCrumbLabels(): ShellCrumbLabels {
  return useContext(LabelsContext);
}

/** Pages publish display names; the shell falls back to slugs until they arrive. */
export function RegisterShellCrumbs({
  projectName = null,
  recordTitle = null,
}: {
  projectName?: string | null;
  recordTitle?: string | null;
}) {
  const actions = useContext(ActionsContext);
  useEffect(() => {
    if (!actions) {
      return;
    }
    const token = actions.publish({ projectName, recordTitle });
    return () => actions.clear(token);
  }, [actions, projectName, recordTitle]);
  return null;
}
