'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Input, Select } from './ui';

export type RecordLinkPickerItem = {
  id: string;
  title: string;
  humanKey?: string | null;
  recordType?: string | null;
};

export type RecordLinkPickerQuery = {
  q: string;
  recordType: string;
  limit: number;
  offset: number;
};

export type RecordLinkPickerPage = {
  items: RecordLinkPickerItem[];
  total: number;
  emptyKind?: 'empty' | 'none' | 'allLinked';
};

const PAGE_SIZES = [5, 10, 25, 50] as const;
type PageSize = (typeof PAGE_SIZES)[number];

function isPageSize(value: number): value is PageSize {
  return (PAGE_SIZES as readonly number[]).includes(value);
}

export function RecordLinkPickerList({
  active,
  load,
  requestKey = '',
  typeOptions,
  selectedIds,
  onToggle,
  selection = 'multiple',
  radioName = 'record-link',
  keyStyle = 'muted',
  debounceMs = 0,
  placeholder,
  emptyLabel,
  noneLabel,
  allLinkedLabel,
  failedLabel,
}: {
  active: boolean;
  load: (query: RecordLinkPickerQuery) => Promise<RecordLinkPickerPage>;
  /** Changes (relation type, exclusions, local catalogue) reload the current filters. */
  requestKey?: string;
  typeOptions: string[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  selection?: 'single' | 'multiple';
  radioName?: string;
  keyStyle?: 'muted' | 'badge';
  debounceMs?: number;
  placeholder?: string;
  emptyLabel?: string;
  noneLabel?: string;
  allLinkedLabel?: string;
  failedLabel?: string;
}) {
  const t = useTranslations('raid');
  const tRecords = useTranslations('records');
  const tCommon = useTranslations('common');
  const loadRef = useRef(load);
  loadRef.current = load;
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(5);
  const [seenKey, setSeenKey] = useState(requestKey);
  const [items, setItems] = useState<RecordLinkPickerItem[]>([]);
  const [total, setTotal] = useState(0);
  const [emptyKind, setEmptyKind] = useState<RecordLinkPickerPage['emptyKind']>('empty');
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  if (seenKey !== requestKey) {
    setSeenKey(requestKey);
    setPage(1);
  }

  function recordTypeLabel(recordType: string): string {
    const key = `typeLabels.${recordType}` as 'typeLabels.note';
    return tRecords.has(key) ? tRecords(key) : recordType;
  }

  useEffect(() => {
    if (!active) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    const delay = query.trim() === '' ? 0 : debounceMs;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const result = await loadRef.current({
            q: query.trim(),
            recordType: typeFilter,
            limit: pageSize,
            offset: (page - 1) * pageSize,
          });
          if (cancelled) {
            return;
          }
          setItems(result.items);
          setTotal(result.total);
          setEmptyKind(result.emptyKind ?? 'empty');
          setFailed(false);
        } catch {
          if (cancelled) {
            return;
          }
          setItems([]);
          setTotal(0);
          setFailed(true);
        } finally {
          if (!cancelled) {
            setLoading(false);
          }
        }
      })();
    }, delay);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [active, debounceMs, page, pageSize, query, requestKey, typeFilter]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const pageStart = (currentPage - 1) * pageSize;
  const emptyMessage = failed
    ? (failedLabel ?? t('documentsNoneToAdd'))
    : query.trim() || typeFilter !== 'all' || emptyKind === 'none'
      ? (noneLabel ?? t('documentsNoneToAdd'))
      : emptyKind === 'allLinked'
        ? (allLinkedLabel ?? t('documentsAllLinked'))
        : (emptyLabel ?? t('documentsEmpty'));

  return (
    <div className="grid gap-3" data-testid="record-link-picker" aria-busy={loading}>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(1);
          }}
          placeholder={placeholder ?? t('documentSearch')}
          data-modal-initial-focus
          className="min-w-[12rem] flex-1"
        />
        <Select
          value={typeFilter}
          onChange={(event) => {
            setTypeFilter(event.target.value);
            setPage(1);
          }}
          aria-label={t('itemsTypeFilter')}
          className="h-10 min-h-10 w-auto min-w-[9rem] py-1.5 text-xs"
        >
          <option value="all">{t('itemsTypeAll')}</option>
          {typeOptions.map((type) => (
            <option key={type} value={type}>
              {recordTypeLabel(type)}
            </option>
          ))}
        </Select>
      </div>
      {loading && items.length === 0 ? (
        <p className="m-0 text-sm text-ink-muted">{tCommon('loading')}</p>
      ) : total === 0 || failed ? (
        <p className="m-0 text-sm text-ink-muted">{emptyMessage}</p>
      ) : (
        <>
          <ul className="m-0 grid list-none gap-2 p-0">
            {items.map((row) => (
              <li key={row.id}>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type={selection === 'single' ? 'radio' : 'checkbox'}
                    name={selection === 'single' ? radioName : undefined}
                    className="mt-0.5"
                    checked={selectedIds.includes(row.id)}
                    onChange={() => onToggle(row.id)}
                  />
                  <span>
                    {row.humanKey ? (
                      keyStyle === 'badge' ? (
                        <span className="kh-ops-key-badge mr-2">{row.humanKey}</span>
                      ) : (
                        <span className="text-ink-muted">{row.humanKey} · </span>
                      )
                    ) : null}
                    {row.title}
                    {row.recordType ? (
                      <span className="text-ink-muted"> · {recordTypeLabel(row.recordType)}</span>
                    ) : null}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
            <p className="m-0 text-xs text-ink-muted">
              {t('documentsShowing', {
                from: total === 0 ? 0 : pageStart + 1,
                to: Math.min(pageStart + pageSize, total),
                total,
              })}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={String(pageSize)}
                onChange={(event) => {
                  const parsed = Number(event.target.value);
                  setPageSize(isPageSize(parsed) ? parsed : 5);
                  setPage(1);
                }}
                aria-label={t('documentsPageSize')}
                className="h-10 min-h-10 w-auto min-w-[9rem] py-1.5 text-xs"
              >
                {PAGE_SIZES.map((size) => (
                  <option key={size} value={String(size)}>
                    {t('documentsPageSizeOption', { count: size })}
                  </option>
                ))}
              </Select>
              <Button
                type="button"
                variant="secondary"
                disabled={currentPage <= 1}
                onClick={() => setPage(Math.max(1, currentPage - 1))}
              >
                {t('documentsPrevPage')}
              </Button>
              <span className="text-xs text-ink-muted">{currentPage} / {totalPages}</span>
              <Button
                type="button"
                variant="secondary"
                disabled={currentPage >= totalPages}
                onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
              >
                {t('documentsNextPage')}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
