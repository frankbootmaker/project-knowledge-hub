'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { DataTable, type DataColumn } from './ui/DataTable';
import { Badge, Button, Input, Select } from './ui';
import { cn } from '../lib/cn';
import {
  applyTableView,
  compareText,
  type SortDir,
} from '../lib/data-table';
import { useSyncEnumFilters, useTableState } from '../lib/use-table-state';
import {
  deliveryScheduleTone,
  todayYmd,
} from '../lib/delivery-schedule';
import type { DashboardAssignedTask } from '../lib/dashboard';

const RACI_LABEL: Record<DashboardAssignedTask['myRole'], string> = {
  R: 'raciResponsible',
  A: 'raciAccountable',
  C: 'raciConsulted',
  I: 'raciInformed',
};

const RACI_ORDER: Record<DashboardAssignedTask['myRole'], number> = {
  A: 0,
  R: 1,
  C: 2,
  I: 3,
};

const STATUS_ORDER = ['todo', 'in_progress', 'blocked', 'done', 'cancelled'] as const;

const DEFAULT_PAGE_SIZE = 5;
const PAGE_SIZE_OPTIONS = [5, 10, 25, 50] as const;
type PageSizeOption = (typeof PAGE_SIZE_OPTIONS)[number];

function isPageSizeOption(value: number): value is PageSizeOption {
  return (PAGE_SIZE_OPTIONS as readonly number[]).includes(value);
}

function taskHref(task: DashboardAssignedTask): string {
  return `/workspaces/${task.workspaceSlug}/projects/${task.projectSlug}?task=${encodeURIComponent(task.id)}#project-delivery`;
}

function compareDue(a: string | null, b: string | null): number {
  if (a && b) return a.localeCompare(b);
  if (a) return -1;
  if (b) return 1;
  return 0;
}

function statusRank(status: string): number {
  const index = STATUS_ORDER.indexOf(status as (typeof STATUS_ORDER)[number]);
  return index === -1 ? STATUS_ORDER.length : index;
}

export function DashboardMyTasks({
  tasks,
}: {
  tasks: DashboardAssignedTask[];
}) {
  const t = useTranslations('dashboard');
  const tDelivery = useTranslations('delivery');
  const tTable = useTranslations('table');
  const locale = useLocale();
  const table = useTableState({
    namespace: 'tasks',
    defaultSortKey: 'due',
    defaultSortDir: 'asc',
  });
  const page = Number(table.extras.page || '1') || 1;
  const parsedSize = Number(table.extras.size || String(DEFAULT_PAGE_SIZE));
  const pageSize = isPageSizeOption(parsedSize) ? parsedSize : DEFAULT_PAGE_SIZE;

  function resetPage() {
    if (page !== 1) table.setExtra('page', '');
  }

  function updateQuery(value: string) {
    table.setQuery(value);
    resetPage();
  }

  function updatePageSize(raw: string) {
    const parsed = Number(raw);
    const next = isPageSizeOption(parsed) ? parsed : DEFAULT_PAGE_SIZE;
    table.setExtra('size', next === DEFAULT_PAGE_SIZE ? '' : String(next));
    table.setExtra('page', '');
  }

  function onToggleSort(key: string, defaultDir?: SortDir) {
    table.toggleSort(key, defaultDir);
    resetPage();
  }

  const statusOptions = useMemo(
    () =>
      STATUS_ORDER.map((value) => ({
        value,
        label: tDelivery(`taskStatus.${value}`),
      })),
    [tDelivery],
  );
  const roleOptions = useMemo(
    () =>
      (Object.keys(RACI_LABEL) as Array<DashboardAssignedTask['myRole']>).map(
        (value) => ({ value, label: t(RACI_LABEL[value]) }),
      ),
    [t],
  );

  const columns = useMemo<Array<DataColumn<DashboardAssignedTask>>>(() => [
    {
      id: 'title',
      header: t('colWorkItem'),
      kind: 'text',
      primary: true,
      sort: { type: 'text', getValue: (task) => task.title },
      cell: (task) => (
        <Link href={taskHref(task)} className="no-underline">
          {task.title}
        </Link>
      ),
    },
    {
      id: 'project',
      header: t('colProject'),
      kind: 'text',
      sort: {
        type: 'text',
        getValue: (task) => `${task.workspaceName} / ${task.projectName}`,
      },
      cell: (task) => (
        <span className="text-ink-muted">
          {task.workspaceName} / {task.projectName}
        </span>
      ),
    },
    {
      id: 'role',
      header: t('colRole'),
      kind: 'status',
      sort: {
        type: 'number',
        compare: (a, b) => RACI_ORDER[a.myRole] - RACI_ORDER[b.myRole],
      },
      filter: {
        type: 'enum',
        getValue: (task) => task.myRole,
        options: roleOptions,
      },
      cell: (task) => (
        <span className="kh-ops-type-chip">{t(RACI_LABEL[task.myRole])}</span>
      ),
    },
    {
      id: 'due',
      header: t('colDue'),
      kind: 'date',
      sort: {
        type: 'date',
        compare: (a, b) => compareDue(a.dueDate, b.dueDate),
      },
      cell: (task) => {
        const scheduleTone = deliveryScheduleTone({
          status: task.status,
          date: task.dueDate,
          today: todayYmd(),
        });
        if (!task.dueDate) return <span className="text-ink-muted">—</span>;
        return (
          <span
            className={cn(
              scheduleTone === 'overdue' && 'font-semibold text-danger',
            )}
          >
            {task.dueDate}
          </span>
        );
      },
    },
    {
      id: 'status',
      header: t('colState'),
      kind: 'status',
      sort: {
        type: 'number',
        compare: (a, b) => statusRank(a.status) - statusRank(b.status),
      },
      filter: {
        type: 'enum',
        getValue: (task) => task.status,
        options: statusOptions,
      },
      cell: (task) => {
        const scheduleTone = deliveryScheduleTone({
          status: task.status,
          date: task.dueDate,
          today: todayYmd(),
        });
        return (
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge>{tDelivery(`taskStatus.${task.status}`)}</Badge>
            <span className="kh-ops-type-chip" data-tone={scheduleTone}>
              {tDelivery(`scheduleToneShort.${scheduleTone}`)}
            </span>
          </div>
        );
      },
    },
  ], [roleOptions, statusOptions, t, tDelivery]);
  useSyncEnumFilters(table.filters, columns, table.setEnumFilter);

  const filtered = useMemo(() => applyTableView({
    rows: tasks,
    locale,
    query: table.query,
    search: (task, needle) =>
      [
        task.title,
        task.projectName,
        task.workspaceName,
        task.status,
        task.myRole,
        task.dueDate ?? '',
        task.currentOwner?.displayName ?? '',
      ]
        .join(' ')
        .toLowerCase()
        .includes(needle),
    sortKey: table.sortKey,
    sortDir: table.sortDir,
    filters: table.filters,
    textFilters: table.textFilters,
    columns,
    tieBreak: (a, b) => compareText(a.title, b.title, locale),
  }), [
    columns,
    locale,
    table.filters,
    table.query,
    table.sortDir,
    table.sortKey,
    table.textFilters,
    tasks,
  ]);

  const activeColumnLabel =
    columns.find((column) => column.id === table.sortKey)?.header ?? t('colDue');

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize) || 1);
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const pageStart = (currentPage - 1) * pageSize;
  const pageItems = filtered.slice(pageStart, pageStart + pageSize);
  const rangeFrom = filtered.length === 0 ? 0 : pageStart + 1;
  const rangeTo = Math.min(pageStart + pageSize, filtered.length);
  const bareEmpty =
    filtered.length === 0 &&
    !table.filtersActive &&
    table.query.trim() === '';

  return (
    <section className="kh-ops-panel">
      <div className="kh-ops-panel-head">
        <h2 className="kh-ops-panel-title">{t('queueTitle')}</h2>
        <span className="kh-ops-panel-meta">
          {t('queueMeta', { column: activeColumnLabel })}
        </span>
      </div>
      <div className="kh-ops-toolbar mb-0 border-0 border-b border-line">
        <label className="flex min-w-[220px] flex-1 items-center gap-2">
          <span className="sr-only">{t('myTasksSearch')}</span>
          <Input
            type="search"
            value={table.query}
            onChange={(event) => updateQuery(event.target.value)}
            placeholder={t('myTasksSearch')}
            className="h-10 min-h-10 py-1.5 text-xs"
          />
        </label>
        <Select
          value={String(pageSize)}
          onChange={(event) => updatePageSize(event.target.value)}
          aria-label={t('pageSize')}
          className="h-10 min-h-10 w-auto min-w-[9rem] py-1.5 text-xs"
        >
          {PAGE_SIZE_OPTIONS.map((size) => (
            <option key={size} value={String(size)}>
              {t('pageSizeOption', { count: size })}
            </option>
          ))}
        </Select>
      </div>
      {bareEmpty ? (
        <p className="kh-ops-empty">{t('myTasksEmpty')}</p>
      ) : (
        <DataTable
          rows={pageItems}
          rowKey={(task) => task.id}
          columns={columns}
          sortKey={table.sortKey}
          sortDir={table.sortDir}
          onToggleSort={onToggleSort}
          enumFilters={table.filters}
          textFilters={table.textFilters}
          onEnumFilter={(key, values) => {
            table.setEnumFilter(key, values);
            resetPage();
          }}
          onTextFilter={(key, value) => {
            table.setTextFilter(key, value);
            resetPage();
          }}
          onClearFilters={() => {
            table.clearFilters();
            resetPage();
          }}
          filtersActive={table.filtersActive}
          tableClassName="kh-ops-delivery-list"
          empty={
            <>
              <h3>{t('queueTitle')}</h3>
              <p>{tTable('emptyFiltered')}</p>
            </>
          }
          footer={
            filtered.length > 0 ? (
              <div className="kh-ops-card-foot">
                <p className="m-0 text-xs text-ink-muted">
                  {t('showing', {
                    from: rangeFrom,
                    to: rangeTo,
                    total: filtered.length,
                  })}
                </p>
                {totalPages > 1 ? (
                  <nav
                    className="flex flex-wrap items-center gap-2"
                    aria-label={t('queueTitle')}
                  >
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={currentPage <= 1}
                      onClick={() => {
                        const next = Math.max(1, currentPage - 1);
                        table.setExtra('page', next <= 1 ? '' : String(next));
                      }}
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
                      onClick={() => {
                        const next = Math.min(totalPages, currentPage + 1);
                        table.setExtra('page', next <= 1 ? '' : String(next));
                      }}
                    >
                      {t('nextPage')}
                    </Button>
                  </nav>
                ) : null}
              </div>
            ) : null
          }
        />
      )}
    </section>
  );
}
