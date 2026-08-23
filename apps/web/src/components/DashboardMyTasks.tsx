'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Badge, Button, Input, Select } from './ui';
import { cn } from '../lib/cn';
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

type SortKey = 'title' | 'project' | 'role' | 'due' | 'status';

function isPageSizeOption(value: number): value is PageSizeOption {
  return (PAGE_SIZE_OPTIONS as readonly number[]).includes(value);
}

function taskHref(task: DashboardAssignedTask): string {
  return `/workspaces/${task.workspaceSlug}/projects/${task.projectSlug}?task=${encodeURIComponent(task.id)}#project-delivery`;
}

function compareText(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: 'base' });
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
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('due');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSizeOption>(DEFAULT_PAGE_SIZE);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((current) => (current === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
    setPage(1);
  }

  function updateQuery(value: string) {
    setQuery(value);
    setPage(1);
  }

  function updatePageSize(raw: string) {
    const parsed = Number(raw);
    setPageSize(isPageSizeOption(parsed) ? parsed : DEFAULT_PAGE_SIZE);
    setPage(1);
  }

  const columns: Array<{ key: SortKey; label: string }> = [
    { key: 'title', label: t('colWorkItem') },
    { key: 'project', label: t('colProject') },
    { key: 'role', label: t('colRole') },
    { key: 'due', label: t('colDue') },
    { key: 'status', label: t('colState') },
  ];

  const activeColumnLabel =
    columns.find((column) => column.key === sortKey)?.label ?? t('colDue');

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rows = needle
      ? tasks.filter((task) =>
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
        )
      : tasks;
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      let result = 0;
      switch (sortKey) {
        case 'title':
          result = compareText(a.title, b.title);
          break;
        case 'project':
          result = compareText(
            `${a.workspaceName} / ${a.projectName}`,
            `${b.workspaceName} / ${b.projectName}`,
          );
          break;
        case 'role':
          result = RACI_ORDER[a.myRole] - RACI_ORDER[b.myRole];
          break;
        case 'status':
          result = statusRank(a.status) - statusRank(b.status);
          break;
        case 'due':
        default:
          result = compareDue(a.dueDate, b.dueDate);
          break;
      }
      if (result === 0) result = compareText(a.title, b.title);
      return result * dir;
    });
  }, [tasks, query, sortDir, sortKey]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize) || 1);
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const pageStart = (currentPage - 1) * pageSize;
  const pageItems = filtered.slice(pageStart, pageStart + pageSize);
  const rangeFrom = filtered.length === 0 ? 0 : pageStart + 1;
  const rangeTo = Math.min(pageStart + pageSize, filtered.length);

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
            value={query}
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
      {filtered.length === 0 ? (
        <p className="kh-ops-empty">{t('myTasksEmpty')}</p>
      ) : (
        <>
          <div className="kh-ops-table-wrap">
            <table className="kh-ops-data-table kh-ops-delivery-list">
              <thead>
                <tr>
                  {columns.map((column) => (
                    <th key={column.key}>
                      <button
                        type="button"
                        data-sort-direction={
                          sortKey === column.key
                            ? (sortDir === 'asc' ? '↑' : '↓')
                            : undefined
                        }
                        aria-label={t('sortBy', { column: column.label })}
                        onClick={() => toggleSort(column.key)}
                      >
                        {column.label}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageItems.map((task) => {
                  const scheduleTone = deliveryScheduleTone({
                    status: task.status,
                    date: task.dueDate,
                    today: todayYmd(),
                  });
                  return (
                    <tr key={task.id}>
                      <td className="kh-ops-primary-cell">
                        <Link href={taskHref(task)} className="no-underline">
                          {task.title}
                        </Link>
                      </td>
                      <td>
                        <span className="text-ink-muted">
                          {task.workspaceName} / {task.projectName}
                        </span>
                      </td>
                      <td>
                        <span className="kh-ops-type-chip">
                          {t(RACI_LABEL[task.myRole])}
                        </span>
                      </td>
                      <td>
                        {task.dueDate ? (
                          <span
                            className={cn(
                              scheduleTone === 'overdue' &&
                                'font-semibold text-danger',
                            )}
                          >
                            {task.dueDate}
                          </span>
                        ) : (
                          <span className="text-ink-muted">—</span>
                        )}
                      </td>
                      <td>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge>{tDelivery(`taskStatus.${task.status}`)}</Badge>
                          <span
                            className="kh-ops-type-chip"
                            data-tone={scheduleTone}
                          >
                            {tDelivery(`scheduleToneShort.${scheduleTone}`)}
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
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
        </>
      )}
    </section>
  );
}
