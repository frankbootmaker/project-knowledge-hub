'use client';

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import {
  columnKindClass,
  EMPTY_FILTER_VALUE,
  type ColumnKind,
  type FilterSpec,
  type SortDir,
  type SortSpec,
} from '../../lib/data-table';
import { cn } from '../../lib/cn';
import { Button } from './Button';
import { Input } from './Field';
import { FilterToggleIcon } from './FilterToggleIcon';

export type DataColumn<T> = {
  id: string;
  header: string;
  kind: ColumnKind;
  sort?: SortSpec<T>;
  filter?: FilterSpec<T>;
  /** Title / name cell. Keeps the existing primary-cell weight. */
  primary?: boolean;
  cell: (row: T) => ReactNode;
};

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

function focusableIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (node) => node.tabIndex !== -1,
  );
}

function ariaSort<T>(
  column: { id: string; sort?: SortSpec<T> },
  sortKey: string | null,
  sortDir: SortDir,
): 'ascending' | 'descending' | 'none' | undefined {
  if (!column.sort) return undefined;
  if (sortKey !== column.id) return 'none';
  return sortDir === 'asc' ? 'ascending' : 'descending';
}

function FilterPopover({
  id,
  anchor,
  label,
  onClose,
  children,
}: {
  id: string;
  anchor: HTMLElement;
  label: string;
  onClose: (restoreFocus: boolean) => void;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const node = panel;
    function place() {
      const rect = anchor.getBoundingClientRect();
      const pop = node.getBoundingClientRect();
      const margin = 8;
      let left = rect.right - pop.width;
      left = Math.max(margin, left);
      if (left + pop.width > window.innerWidth - margin) {
        left = Math.max(margin, window.innerWidth - margin - pop.width);
      }
      let top = rect.bottom + margin;
      if (top + pop.height > window.innerHeight - margin) {
        const above = rect.top - margin - pop.height;
        top = above >= margin ? above : margin;
      }
      node.style.setProperty('--kh-pop-top', `${top}px`);
      node.style.setProperty('--kh-pop-left', `${left}px`);
    }
    place();
    function onScroll(event: Event) {
      const target = event.target;
      if (target instanceof Node && node.contains(target)) return;
      place();
    }
    window.addEventListener('resize', place);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [anchor]);

  useEffect(() => {
    const panel = panelRef.current;
    const focusable = panel?.querySelector<HTMLElement>(
      'input, button, [href], select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    (focusable ?? panel)?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose(true);
        return;
      }
      if (event.key !== 'Tab' || !panel) return;
      const items = focusableIn(panel);
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const active = document.activeElement;
      const inside = active instanceof Node && panel.contains(active);
      if (event.shiftKey) {
        if (!inside || active === first) {
          event.preventDefault();
          last.focus();
        }
        return;
      }
      if (!inside || active === last) {
        event.preventDefault();
        first.focus();
      }
    }
    function onPointer(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panel?.contains(target) || anchor.contains(target)) return;
      onClose(false);
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointer);
    };
  }, [anchor, onClose]);

  return createPortal(
    <div
      ref={panelRef}
      id={id}
      className="kh-ops-popover kh-ops-table-filter"
      role="dialog"
      aria-label={label}
      tabIndex={-1}
    >
      {children}
    </div>,
    document.body,
  );
}

export function DataTable<T>({
  rows,
  rowKey,
  columns,
  sortKey,
  sortDir,
  onToggleSort,
  enumFilters,
  textFilters,
  onEnumFilter,
  onTextFilter,
  onClearFilters,
  filtersActive,
  empty,
  tableClassName,
  footer,
}: {
  rows: T[];
  rowKey: (row: T) => string;
  columns: Array<DataColumn<T>>;
  sortKey: string | null;
  sortDir: SortDir;
  onToggleSort: (columnId: string, defaultDir?: SortDir) => void;
  enumFilters: Record<string, string[]>;
  textFilters: Record<string, string>;
  onEnumFilter: (columnId: string, values: string[]) => void;
  onTextFilter: (columnId: string, value: string) => void;
  onClearFilters: () => void;
  filtersActive: boolean;
  empty?: ReactNode;
  tableClassName?: string;
  footer?: ReactNode;
}) {
  const t = useTranslations('table');
  const filterColumns = columns.filter((column) => {
    const filter = column.filter;
    if (!filter) return false;
    if (filter.type === 'text') return true;
    return (filter.options?.length ?? 0) > 0;
  });
  const panelId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const closeFilters = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);
  const embedFilters =
    filterColumns.length > 0 &&
    columns.some((column) => column.kind === 'actions');

  useEffect(() => {
    if (open && filterColumns.length === 0) setOpen(false);
  }, [filterColumns.length, open]);

  function toggleValue(columnId: string, value: string, checked: boolean) {
    const current = enumFilters[columnId] ?? [];
    const next = checked
      ? [...current, value]
      : current.filter((item) => item !== value);
    onEnumFilter(columnId, next);
  }

  const filterControl = filterColumns.length > 0 ? (
    <>
      <Button
        ref={triggerRef}
        type="button"
        variant="secondary"
        className={cn(
          'kh-ops-filter-btn relative size-[2.0475rem] shrink-0 px-0 py-0',
          open && 'ring-2 ring-brand/35',
        )}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? panelId : undefined}
        aria-label={open ? t('hideFilters') : t('showFilters')}
        onClick={() => setOpen((current) => !current)}
      >
        <FilterToggleIcon />
        {filtersActive ? (
          <span className="kh-ops-filter-dot" aria-hidden />
        ) : null}
      </Button>
      {open && triggerRef.current ? (
        <FilterPopover
          id={panelId}
          anchor={triggerRef.current}
          label={t('filters')}
          onClose={closeFilters}
        >
          <div className="kh-ops-table-filter-body">
            {filterColumns.map((column) => {
              const filter = column.filter;
              if (!filter) return null;
              if (filter.type === 'text') {
                return (
                  <label
                    key={column.id}
                    className="kh-ops-table-filter-group"
                  >
                    <span>{column.header}</span>
                    <Input
                      type="search"
                      value={textFilters[column.id] ?? ''}
                      placeholder={t('textPlaceholder')}
                      aria-label={t('filterColumn', {
                        column: column.header,
                      })}
                      onChange={(event) =>
                        onTextFilter(column.id, event.target.value)
                      }
                    />
                  </label>
                );
              }
              const declared = filter.options ?? [];
              const known = new Set(declared.map((option) => option.value));
              const options = declared.map((option) => ({
                value: option.value,
                label:
                  option.value === EMPTY_FILTER_VALUE ? '—' : option.label,
              }));
              for (const value of enumFilters[column.id] ?? []) {
                if (known.has(value)) continue;
                options.push({
                  value,
                  label: value === EMPTY_FILTER_VALUE ? '—' : value,
                });
              }
              if (options.length === 0) return null;
              const selected = new Set(enumFilters[column.id] ?? []);
              return (
                <fieldset
                  key={column.id}
                  className="kh-ops-table-filter-group"
                >
                  <legend>{column.header}</legend>
                  <ul className="kh-ops-check-list">
                    {options.map((option) => {
                      const checked = selected.has(option.value);
                      return (
                        <li key={option.value}>
                          <label data-checked={checked ? 'true' : 'false'}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(event) =>
                                toggleValue(
                                  column.id,
                                  option.value,
                                  event.target.checked,
                                )
                              }
                            />
                            {option.label}
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </fieldset>
              );
            })}
            <Button
              type="button"
              variant="secondary"
              disabled={!filtersActive}
              onClick={() => {
                onClearFilters();
                closeFilters(true);
              }}
            >
              {t('clearFilters')}
            </Button>
          </div>
        </FilterPopover>
      ) : null}
    </>
  ) : null;

  return (
    <>
      <div className="kh-ops-table-wrap kh-ops-table-wrap--sticky">
        <table
          className={cn(
            'kh-ops-data-table',
            'kh-ops-data-table--fluid',
            tableClassName,
          )}
        >
          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.id}
                  className={columnKindClass(column.kind)}
                  aria-sort={ariaSort(column, sortKey, sortDir)}
                >
                  {column.sort ? (
                    <button
                      type="button"
                      className="kh-ops-sort-btn"
                      data-sort-direction={
                        sortKey === column.id
                          ? (sortDir === 'asc' ? '↑' : '↓')
                          : undefined
                      }
                      aria-label={t('sortBy', { column: column.header })}
                      onClick={() =>
                        onToggleSort(column.id, column.sort?.defaultDir)
                      }
                    >
                      {column.header}
                    </button>
                  ) : column.header ? (
                    column.header
                  ) : (
                    <span className="sr-only">{t('actions')}</span>
                  )}
                  {embedFilters && column.kind === 'actions'
                    ? filterControl
                    : null}
                </th>
              ))}
              {!embedFilters && filterColumns.length > 0 ? (
                <th className="kh-ops-cell-actions">{filterControl}</th>
              ) : null}
            </tr>
          </thead>
          {rows.length > 0 ? (
            <tbody>
              {rows.map((row) => (
                <tr key={rowKey(row)}>
                  {columns.map((column) => (
                    <td
                      key={column.id}
                      className={cn(
                        columnKindClass(column.kind),
                        column.primary && 'kh-ops-primary-cell',
                      )}
                    >
                      {column.cell(row)}
                    </td>
                  ))}
                  {!embedFilters && filterColumns.length > 0 ? (
                    <td className="kh-ops-cell-actions" />
                  ) : null}
                </tr>
              ))}
            </tbody>
          ) : null}
        </table>
      </div>
      {rows.length === 0 && empty ? (
        <div className="kh-ops-empty-state">
          <div className="kh-ops-empty-mark">00</div>
          {empty}
          {filtersActive ? (
            <Button type="button" variant="secondary" onClick={onClearFilters}>
              {t('clearFilters')}
            </Button>
          ) : null}
        </div>
      ) : null}
      {footer}
    </>
  );
}
