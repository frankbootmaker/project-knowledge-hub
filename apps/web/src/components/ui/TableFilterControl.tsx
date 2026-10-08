'use client';

import {
  Fragment,
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
import { EMPTY_FILTER_VALUE } from '../../lib/data-table';
import { cn } from '../../lib/cn';
import { Button } from './Button';
import { Input } from './Field';
import { FilterToggleIcon } from './FilterToggleIcon';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

function focusableIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((node) => node.tabIndex !== -1);
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

export type TableFilterField = {
  id: string;
  header: string;
  type: 'text' | 'enum';
  options?: Array<{ value: string; label: string }>;
};

export function TableFilterControl({
  fields,
  enumFilters,
  textFilters,
  onEnumFilter,
  onTextFilter,
  onClearFilters,
  filtersActive,
  insertAfter,
}: {
  fields: TableFilterField[];
  enumFilters: Record<string, string[]>;
  textFilters: Record<string, string>;
  onEnumFilter: (columnId: string, values: string[]) => void;
  onTextFilter: (columnId: string, value: string) => void;
  onClearFilters: () => void;
  filtersActive: boolean;
  /** Extra control rendered after the named field. Omitted by DataTable. */
  insertAfter?: { id: string; content: ReactNode } | null;
}) {
  const t = useTranslations('table');
  const panelId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const closeFilters = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (open && fields.length === 0) setOpen(false);
  }, [fields.length, open]);

  function toggleValue(columnId: string, value: string, checked: boolean) {
    const current = enumFilters[columnId] ?? [];
    const next = checked ? [...current, value] : current.filter((item) => item !== value);
    onEnumFilter(columnId, next);
  }

  if (fields.length === 0) return null;

  return (
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
        {filtersActive ? <span className="kh-ops-filter-dot" aria-hidden /> : null}
      </Button>
      {open && triggerRef.current ? (
        <FilterPopover
          id={panelId}
          anchor={triggerRef.current}
          label={t('filters')}
          onClose={closeFilters}
        >
          <div className="kh-ops-table-filter-body">
            {fields.map((field) => {
              const control =
                field.type === 'text' ? (
                  <label key={field.id} className="kh-ops-table-filter-group">
                    <span>{field.header}</span>
                    <Input
                      type="search"
                      value={textFilters[field.id] ?? ''}
                      placeholder={t('textPlaceholder')}
                      aria-label={t('filterColumn', { column: field.header })}
                      onChange={(event) => onTextFilter(field.id, event.target.value)}
                    />
                  </label>
                ) : (
                  renderEnumField(field, enumFilters, toggleValue)
                );
              if (!control && insertAfter?.id !== field.id) return null;
              return (
                <Fragment key={field.id}>
                  {control}
                  {insertAfter?.id === field.id ? insertAfter.content : null}
                </Fragment>
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
  );
}

function renderEnumField(
  field: TableFilterField,
  enumFilters: Record<string, string[]>,
  toggleValue: (columnId: string, value: string, checked: boolean) => void,
) {
  const declared = field.options ?? [];
  const known = new Set(declared.map((option) => option.value));
  const options = declared.map((option) => ({
    value: option.value,
    label: option.value === EMPTY_FILTER_VALUE ? '—' : option.label,
  }));
  for (const value of enumFilters[field.id] ?? []) {
    if (known.has(value)) continue;
    options.push({
      value,
      label: value === EMPTY_FILTER_VALUE ? '—' : value,
    });
  }
  if (options.length === 0) return null;
  const selected = new Set(enumFilters[field.id] ?? []);
  return (
    <fieldset className="kh-ops-table-filter-group">
      <legend>{field.header}</legend>
      <ul className="kh-ops-check-list">
        {options.map((option) => {
          const checked = selected.has(option.value);
          return (
            <li key={option.value}>
              <label data-checked={checked ? 'true' : 'false'}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => toggleValue(field.id, option.value, event.target.checked)}
                />
                {option.label}
              </label>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}
