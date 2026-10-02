'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createDebouncedUrlWriter,
  enumFiltersEqual,
  hasActiveFilters,
  readTableState,
  reduceTableState,
  sanitizeEnumFilters,
  serializeTableQuery,
  type FilterSpec,
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
  const defaultsRef = useRef(defaults);
  defaultsRef.current = defaults;

  const persist = useCallback((next: TableQueryState) => {
    try {
      const url = new URL(window.location.href);
      const search = serializeTableQuery(
        url.search,
        namespace,
        next,
        defaultsRef.current,
      );
      const nextHref = `${url.pathname}${search}${url.hash}`;
      const current = `${url.pathname}${url.search}${url.hash}`;
      if (nextHref !== current) {
        window.history.replaceState(null, '', nextHref);
      }
    } catch {
      /* ignore malformed locations */
    }
  }, [namespace]);
  const persistRef = useRef(persist);
  persistRef.current = persist;

  const writerRef = useRef<ReturnType<typeof createDebouncedUrlWriter> | null>(
    null,
  );
  if (writerRef.current == null) {
    writerRef.current = createDebouncedUrlWriter({
      write: () => persistRef.current(stateRef.current),
    });
  }

  useEffect(() => {
    writerRef.current?.cancel();
    const next = readTableState(
      window.location.search,
      namespace,
      defaultsRef.current,
    );
    stateRef.current = next;
    setState(next);
    hydrated.current = true;
    function onPopState() {
      writerRef.current?.cancel();
      const restored = readTableState(
        window.location.search,
        namespace,
        defaultsRef.current,
      );
      stateRef.current = restored;
      setState(restored);
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [namespace, defaultSortKey, defaultSortDir]);

  useEffect(() => () => writerRef.current?.flush(), []);

  const dispatch = useCallback((action: TableAction) => {
    const next = reduceTableState(stateRef.current, action);
    if (next === stateRef.current) return;
    stateRef.current = next;
    setState(next);
    if (hydrated.current) writerRef.current?.push();
  }, []);

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

export function useSyncEnumFilters<T>(
  filters: Record<string, string[]>,
  columns: Array<{ id: string; filter?: FilterSpec<T> }>,
  setEnumFilter: (key: string, values: string[]) => void,
): void {
  const setRef = useRef(setEnumFilter);
  setRef.current = setEnumFilter;
  useEffect(() => {
    const next = sanitizeEnumFilters(filters, columns);
    if (enumFiltersEqual(filters, next)) return;
    const keys = new Set([...Object.keys(filters), ...Object.keys(next)]);
    for (const key of keys) {
      const left = filters[key] ?? [];
      const right = next[key] ?? [];
      if (
        left.length !== right.length ||
        left.some((value, index) => value !== right[index])
      ) {
        setRef.current(key, right);
      }
    }
  }, [columns, filters]);
}
