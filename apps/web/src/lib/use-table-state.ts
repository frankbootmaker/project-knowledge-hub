'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  hasActiveFilters,
  readTableState,
  reduceTableState,
  serializeTableQuery,
  type SortDir,
  type TableAction,
  type TableQueryState,
} from './data-table';

function emptyState(
  sortKey: string | null,
  sortDir: SortDir,
): TableQueryState {
  return {
    q: '',
    sortKey,
    sortDir,
    filters: {},
    textFilters: {},
    extras: {},
  };
}

export function useTableState(options: {
  namespace: string;
  defaultSortKey: string | null;
  defaultSortDir?: SortDir;
}) {
  const { namespace, defaultSortKey } = options;
  const defaultSortDir = options.defaultSortDir ?? 'asc';
  const defaults = { sortKey: defaultSortKey, sortDir: defaultSortDir };
  const [state, setState] = useState<TableQueryState>(() =>
    emptyState(defaultSortKey, defaultSortDir),
  );
  const stateRef = useRef(state);
  stateRef.current = state;
  const hydrated = useRef(false);

  const persist = useCallback(
    (next: TableQueryState) => {
      try {
        const url = new URL(window.location.href);
        const search = serializeTableQuery(
          url.search,
          namespace,
          next,
          defaults,
        );
        const nextHref = `${url.pathname}${search}${url.hash}`;
        const current = `${url.pathname}${url.search}${url.hash}`;
        if (nextHref !== current) {
          window.history.replaceState(null, '', nextHref);
        }
      } catch {
        /* ignore malformed locations */
      }
    },
    [namespace, defaultSortKey, defaultSortDir],
  );

  useEffect(() => {
    const next = readTableState(window.location.search, namespace, defaults);
    stateRef.current = next;
    setState(next);
    hydrated.current = true;
    function onPopState() {
      const restored = readTableState(
        window.location.search,
        namespace,
        defaults,
      );
      stateRef.current = restored;
      setState(restored);
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [namespace, defaultSortKey, defaultSortDir]);

  const dispatch = useCallback(
    (action: TableAction) => {
      const next = reduceTableState(stateRef.current, action);
      stateRef.current = next;
      setState(next);
      if (hydrated.current) persist(next);
    },
    [persist],
  );

  const setQuery = useCallback(
    (q: string) => dispatch({ type: 'query', q }),
    [dispatch],
  );
  const toggleSort = useCallback(
    (key: string, defaultDir?: SortDir) =>
      dispatch({ type: 'toggleSort', key, defaultDir }),
    [dispatch],
  );
  const setEnumFilter = useCallback(
    (key: string, values: string[]) => dispatch({ type: 'enum', key, values }),
    [dispatch],
  );
  const setTextFilter = useCallback(
    (key: string, value: string) => dispatch({ type: 'text', key, value }),
    [dispatch],
  );
  const setExtra = useCallback(
    (key: string, value: string) => dispatch({ type: 'extra', key, value }),
    [dispatch],
  );
  const clearFilters = useCallback(
    () => dispatch({ type: 'clearFilters' }),
    [dispatch],
  );

  return {
    query: state.q,
    sortKey: state.sortKey,
    sortDir: state.sortDir,
    filters: state.filters,
    textFilters: state.textFilters,
    extras: state.extras,
    filtersActive: hasActiveFilters(state),
    setQuery,
    toggleSort,
    setEnumFilter,
    setTextFilter,
    setExtra,
    clearFilters,
  };
}
