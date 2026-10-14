'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Input, Select } from './ui';

export type DeliveryPickerEntityType =
  | 'epic'
  | 'user_story'
  | 'task'
  | 'milestone'
  | 'sprint';

export type DeliveryPickerItem = {
  id: string;
  title: string;
  humanKey?: string | null;
  status?: string | null;
  entityType: DeliveryPickerEntityType;
  itemType?: string | null;
};

type ItemTypeFilter = 'all' | DeliveryPickerEntityType | 'bug';

const PAGE_SIZES = [5, 10, 25, 50] as const;
type PageSize = (typeof PAGE_SIZES)[number];

function isPageSize(value: number): value is PageSize {
  return (PAGE_SIZES as readonly number[]).includes(value);
}

function filterKind(row: DeliveryPickerItem): ItemTypeFilter {
  if (row.entityType === 'task') {
    return row.itemType === 'bug' ? 'bug' : 'task';
  }
  return row.entityType;
}

export function DeliveryItemLinkPicker({
  items,
  hiddenIds,
  selectedIds,
  onToggle,
  includeSprint = false,
}: {
  items: DeliveryPickerItem[];
  hiddenIds: string[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  includeSprint?: boolean;
}) {
  const t = useTranslations('raid');
  const tDelivery = useTranslations('delivery');
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<ItemTypeFilter>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(5);

  function statusLabel(status: string, entityType: string): string {
    if (entityType !== 'task') {
      if (
        status === 'planned'
        || status === 'active'
        || status === 'done'
        || status === 'cancelled'
      ) {
        return tDelivery(`milestoneStatus.${status}`);
      }
      return status;
    }
    if (
      status === 'todo'
      || status === 'in_progress'
      || status === 'blocked'
      || status === 'done'
      || status === 'cancelled'
    ) {
      return tDelivery(`taskStatus.${status}`);
    }
    return status;
  }

  function kindLabel(kind: ItemTypeFilter): string | null {
    if (kind === 'all') return null;
    if (kind === 'epic') return t('itemsTypeEpic');
    if (kind === 'user_story') return t('itemsTypeStory');
    if (kind === 'bug') return t('itemsTypeBug');
    if (kind === 'milestone') return t('itemsTypeMilestone');
    if (kind === 'sprint') return t('itemsTypeSprint');
    return t('itemsTypeTask');
  }

  const hidden = new Set(hiddenIds);
  const needle = query.trim().toLowerCase();
  const available = items.filter((row) => {
    if (hidden.has(row.id)) return false;
    if (typeFilter !== 'all' && filterKind(row) !== typeFilter) return false;
    if (!needle) return true;
    const status = row.status
      ? statusLabel(row.status, row.entityType)
      : '';
    const haystack = `${row.humanKey ?? ''} ${row.title} ${status}`.toLowerCase();
    return haystack.includes(needle);
  });
  const totalPages = Math.max(1, Math.ceil(available.length / pageSize) || 1);
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const pageStart = (currentPage - 1) * pageSize;
  const pageItems = available.slice(pageStart, pageStart + pageSize);
  const rangeFrom = available.length === 0 ? 0 : pageStart + 1;
  const rangeTo = Math.min(pageStart + pageSize, available.length);

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(1);
          }}
          placeholder={t('taskSearch')}
          data-modal-initial-focus
          className="min-w-[12rem] flex-1"
        />
        <Select
          value={typeFilter}
          onChange={(event) => {
            setTypeFilter(event.target.value as ItemTypeFilter);
            setPage(1);
          }}
          aria-label={t('itemsTypeFilter')}
          className="h-10 min-h-10 w-auto min-w-[9rem] py-1.5 text-xs"
        >
          <option value="all">{t('itemsTypeAll')}</option>
          <option value="epic">{t('itemsTypeEpic')}</option>
          <option value="user_story">{t('itemsTypeStory')}</option>
          <option value="task">{t('itemsTypeTask')}</option>
          <option value="bug">{t('itemsTypeBug')}</option>
          <option value="milestone">{t('itemsTypeMilestone')}</option>
          {includeSprint ? (
            <option value="sprint">{t('itemsTypeSprint')}</option>
          ) : null}
        </Select>
      </div>
      {available.length === 0 ? (
        <p className="m-0 text-sm text-ink-muted">
          {t(
            needle || typeFilter !== 'all'
              ? 'tasksNoneToAdd'
              : items.length === 0
                ? 'noTasks'
                : 'tasksAllLinked',
          )}
        </p>
      ) : (
        <>
          <ul className="m-0 grid list-none gap-2 p-0">
            {pageItems.map((row) => (
              <li key={row.id}>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={selectedIds.includes(row.id)}
                    onChange={() => onToggle(row.id)}
                  />
                  <span>
                    {row.humanKey ? (
                      <span className="text-ink-muted">{row.humanKey} · </span>
                    ) : null}
                    {row.title}
                    <span className="text-ink-muted">
                      {' '}
                      · {kindLabel(filterKind(row))}
                    </span>
                    {row.status ? (
                      <span className="text-ink-muted">
                        {' '}
                        ({statusLabel(row.status, row.entityType)})
                      </span>
                    ) : null}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
            <p className="m-0 text-xs text-ink-muted">
              {t('documentsShowing', {
                from: rangeFrom,
                to: rangeTo,
                total: available.length,
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
              <nav
                className="flex flex-wrap items-center gap-2"
                aria-label={t('tasksAddTitle')}
              >
                <Button
                  type="button"
                  variant="secondary"
                  disabled={currentPage <= 1}
                  onClick={() => setPage(Math.max(1, currentPage - 1))}
                >
                  {t('documentsPrevPage')}
                </Button>
                <span className="text-xs text-ink-muted" aria-current="page">
                  {currentPage} / {totalPages}
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={currentPage >= totalPages}
                  onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
                >
                  {t('documentsNextPage')}
                </Button>
              </nav>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
