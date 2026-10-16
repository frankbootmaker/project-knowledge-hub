'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import type { DashboardRecentItem } from '../lib/dashboard';
import { collectEnumOptions } from '../lib/data-table';
import { useTableState } from '../lib/use-table-state';
import { LocalDateTime } from './LocalDateTime';
import { Badge, Button, Input, Select, lifecycleLabel } from './ui';
import { TableFilterControl, type TableFilterField } from './ui/TableFilterControl';

const DEFAULT_PAGE_SIZE = 5;
const PAGE_SIZE_OPTIONS = [5, 10, 25, 50] as const;
type PageSizeOption = (typeof PAGE_SIZE_OPTIONS)[number];

function isPageSizeOption(value: number): value is PageSizeOption {
  return (PAGE_SIZE_OPTIONS as readonly number[]).includes(value);
}

export function DashboardRecentList({
  items,
}: {
  items: DashboardRecentItem[];
}) {
  const t = useTranslations('dashboard');
  const tTable = useTranslations('table');
  const tDelivery = useTranslations('delivery');
  const tRecords = useTranslations('records');
  const locale = useLocale();
  const table = useTableState({ namespace: 'recent', defaultSortKey: null });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSizeOption>(DEFAULT_PAGE_SIZE);

  function kindLabel(kind: DashboardRecentItem['kind']): string {
    if (kind === 'project') return t('kindProject');
    if (kind === 'system') return t('kindSystem');
    return t('kindRecord');
  }

  function stateLabel(item: DashboardRecentItem): string {
    if (!item.status) return '';
    if (item.kind === 'record') return lifecycleLabel(item.status, tRecords);
    const catalogueStatuses = [
      'idea',
      'planned',
      'active',
      'maintenance',
      'paused',
      'completed',
      'archived',
      'proposed',
      'experimental',
      'degraded',
      'deprecated',
      'retired',
    ];
    if (!catalogueStatuses.includes(item.status)) return item.status;
    return t(`entityStatus.${item.status}`);
  }

  function updateQuery(value: string) {
    table.setQuery(value);
    setPage(1);
  }

  function updatePageSize(raw: string) {
    const parsed = Number(raw);
    setPageSize(isPageSizeOption(parsed) ? parsed : DEFAULT_PAGE_SIZE);
    setPage(1);
  }

  const kindOptions = useMemo(
    () =>
      collectEnumOptions(
        items,
        (item) => item.kind,
        (value) => kindLabel(value as DashboardRecentItem['kind']),
        locale,
      ),
    [items, locale, t],
  );
  const workspaceOptions = useMemo(
    () =>
      collectEnumOptions(
        items,
        (item) => item.workspaceName,
        (value) => value,
        locale,
      ),
    [items, locale],
  );
  const filterFields = useMemo<TableFilterField[]>(
    () => [
      {
        id: 'kind',
        header: t('colKind'),
        type: 'enum',
        options: kindOptions,
      },
      {
        id: 'workspace',
        header: t('colWorkspace'),
        type: 'enum',
        options: workspaceOptions,
      },
    ],
    [kindOptions, t, workspaceOptions],
  );

  const filtered = useMemo(() => {
    const needle = table.query.trim().toLowerCase();
    const kinds = table.filters.kind ?? [];
    const workspaces = table.filters.workspace ?? [];
    return items.filter((item) => {
      if (kinds.length > 0 && !kinds.includes(item.kind)) return false;
      if (workspaces.length > 0 && !workspaces.includes(item.workspaceName)) return false;
      if (!needle) return true;
      return [
        item.title,
        item.workspaceName,
        item.humanKey ?? '',
        kindLabel(item.kind),
        stateLabel(item),
      ]
        .join(' ')
        .toLowerCase()
        .includes(needle);
    });
  }, [items, table.filters.kind, table.filters.workspace, table.query, t, tRecords]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize) || 1);
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const pageStart = (currentPage - 1) * pageSize;
  const pageItems = filtered.slice(pageStart, pageStart + pageSize);
  const rangeFrom = filtered.length === 0 ? 0 : pageStart + 1;
  const rangeTo = Math.min(pageStart + pageSize, filtered.length);
  const bareEmpty = items.length === 0;

  return (
    <section className="kh-ops-panel">
      <div className="kh-ops-panel-head">
        <h2 className="kh-ops-panel-title">{t('recentTitle')}</h2>
      </div>
      {bareEmpty ? (
        <p className="kh-ops-empty">{t('recentEmpty')}</p>
      ) : (
        <>
          <div className="kh-ops-toolbar mb-0 border-0 border-b border-line">
            <label className="flex min-w-[220px] flex-1 items-center gap-2">
              <span className="sr-only">{t('recentSearch')}</span>
              <Input
                type="search"
                value={table.query}
                onChange={(event) => updateQuery(event.target.value)}
                placeholder={t('recentSearch')}
                className="h-10 min-h-10 py-1.5 text-xs"
              />
            </label>
            <TableFilterControl
              fields={filterFields}
              enumFilters={table.filters}
              textFilters={table.textFilters}
              onEnumFilter={(key, values) => {
                table.setEnumFilter(key, values);
                setPage(1);
              }}
              onTextFilter={(key, value) => {
                table.setTextFilter(key, value);
                setPage(1);
              }}
              onClearFilters={() => {
                table.clearFilters();
                setPage(1);
              }}
              filtersActive={table.filtersActive}
            />
            {table.filtersActive ? (
              <Button
                type="button"
                variant="secondary"
                className="kh-ops-tree-filter-clear h-8 min-h-8 px-2 text-xs"
                onClick={() => {
                  table.clearFilters();
                  setPage(1);
                }}
              >
                {tTable('clearFilters')}
              </Button>
            ) : null}
          </div>
          {filtered.length === 0 ? (
            <p className="kh-ops-empty">{tTable('emptyFiltered')}</p>
          ) : (
            <div className="kh-ops-table-wrap">
              <table className="kh-ops-data-table">
                <thead>
                  <tr>
                    <th>{tDelivery('colId')}</th>
                    <th>{t('colWorkItem')}</th>
                    <th>{t('colKind')}</th>
                    <th>{t('colWorkspace')}</th>
                    <th>{t('colUpdated')}</th>
                    <th>{t('colState')}</th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((item) => (
                    <tr key={`${item.kind}-${item.id}`}>
                      <td>
                        {item.humanKey ? (
                          <Link href={item.href} className="kh-ops-key-badge no-underline">
                            {item.humanKey}
                          </Link>
                        ) : (
                          <span className="text-ink-muted">—</span>
                        )}
                      </td>
                      <td className="kh-ops-primary-cell">
                        <Link href={item.href} className="no-underline">
                          {item.title}
                        </Link>
                      </td>
                      <td>
                        <span className="kh-ops-type-chip">{kindLabel(item.kind)}</span>
                      </td>
                      <td>{item.workspaceName}</td>
                      <td>
                        <LocalDateTime value={item.updatedAt} />
                      </td>
                      <td>
                        {item.status ? (
                          <Badge>{stateLabel(item)}</Badge>
                        ) : (
                          <span className="text-ink-muted">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {filtered.length > 0 ? (
            <div className="kh-ops-card-foot kh-ops-catalogue-pager">
              <p className="m-0 text-ink-muted">
                {t('showing', {
                  from: rangeFrom,
                  to: rangeTo,
                  total: filtered.length,
                })}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  value={String(pageSize)}
                  onChange={(event) => updatePageSize(event.target.value)}
                  aria-label={t('pageSize')}
                  className="h-10 min-h-10 w-auto min-w-[9rem] py-1.5"
                >
                  {PAGE_SIZE_OPTIONS.map((size) => (
                    <option key={size} value={String(size)}>
                      {t('pageSizeOption', { count: size })}
                    </option>
                  ))}
                </Select>
                {totalPages > 1 ? (
                  <nav
                    className="flex flex-wrap items-center gap-2"
                    aria-label={t('recentTitle')}
                  >
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={currentPage <= 1}
                      onClick={() => setPage(Math.max(1, currentPage - 1))}
                    >
                      {t('prevPage')}
                    </Button>
                    <span className="kh-page-num-active" aria-current="page">
                      {currentPage} / {totalPages}
                    </span>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={currentPage >= totalPages}
                      onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
                    >
                      {t('nextPage')}
                    </Button>
                  </nav>
                ) : null}
              </div>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
