'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Input, Select } from './ui';
import { toHours } from '../lib/task-costing';

export type DeliveryListKind = 'epic' | 'story' | 'milestone' | 'task';

export type DeliveryListRow = {
  id: string;
  kind: DeliveryListKind;
  entityId: string;
  humanKey: string | null;
  title: string;
  status: string;
  owner: string | null;
  sprint: string | null;
  forecastHours: string | number | null;
  actualHours: string | number | null;
  storyPoints: number | null;
  updatedAt: string | null;
  searchText: string;
};

type SortKey =
  | 'id'
  | 'title'
  | 'status'
  | 'owner'
  | 'sprint'
  | 'forecast'
  | 'actual'
  | 'points'
  | 'updated';

const MILESTONE_STATUSES = ['planned', 'active', 'done', 'cancelled'] as const;
const TASK_STATUSES = ['todo', 'in_progress', 'blocked', 'done', 'cancelled'] as const;
const KIND_LABEL = {
  epic: 'kindEpic',
  story: 'kindStory',
  milestone: 'kindMilestone',
  task: 'kindTask',
} as const;

function compareText(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: 'base' });
}

function hoursValue(value: string | number | null | undefined): number {
  return toHours(value) ?? -1;
}

export function ProjectDeliveryList({
  rows,
  canMutate,
  pending,
  onManage,
  onStatusChange,
}: {
  rows: DeliveryListRow[];
  canMutate: boolean;
  pending: boolean;
  onManage: (kind: DeliveryListKind, entityId: string) => void;
  onStatusChange: (kind: DeliveryListKind, entityId: string, status: string) => void;
}) {
  const t = useTranslations('delivery');
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('updated');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((current) => (current === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    setSortDir(key === 'updated' || key === 'forecast' || key === 'actual' || key === 'points'
      ? 'desc'
      : 'asc');
  }

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matched = needle
      ? rows.filter((row) => row.searchText.includes(needle))
      : rows;
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...matched].sort((a, b) => {
      let result = 0;
      switch (sortKey) {
        case 'id':
          result = compareText(a.humanKey ?? '', b.humanKey ?? '');
          break;
        case 'title':
          result = compareText(a.title, b.title);
          break;
        case 'status':
          result = compareText(a.status, b.status);
          break;
        case 'owner':
          result = compareText(a.owner ?? '', b.owner ?? '');
          break;
        case 'sprint':
          result = compareText(a.sprint ?? '', b.sprint ?? '');
          break;
        case 'forecast':
          result = hoursValue(a.forecastHours) - hoursValue(b.forecastHours);
          break;
        case 'actual':
          result = hoursValue(a.actualHours) - hoursValue(b.actualHours);
          break;
        case 'points':
          result = (a.storyPoints ?? -1) - (b.storyPoints ?? -1);
          break;
        default:
          result = compareText(a.updatedAt ?? '', b.updatedAt ?? '');
      }
      if (result === 0) result = compareText(a.title, b.title);
      return result * dir;
    });
  }, [query, rows, sortDir, sortKey]);

  const columns: Array<{ key: SortKey; label: string; numeric?: boolean }> = [
    { key: 'id', label: t('colId') },
    { key: 'title', label: t('colTitle') },
    { key: 'status', label: t('colStatus') },
    { key: 'owner', label: t('colOwner') },
    { key: 'sprint', label: t('colSprint') },
    { key: 'forecast', label: t('colForecast'), numeric: true },
    { key: 'actual', label: t('colActual'), numeric: true },
    { key: 'points', label: t('colPoints'), numeric: true },
    { key: 'updated', label: t('colUpdated') },
  ];

  return (
    <section className="kh-ops-panel">
      <div className="kh-ops-toolbar mb-0 border-0 border-b border-line">
        <label className="flex min-w-[220px] flex-1 items-center gap-2">
          <span className="sr-only">{t('searchPlaceholder')}</span>
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('searchPlaceholder')}
            className="h-10 min-h-10 py-1.5 text-xs"
          />
        </label>
      </div>
      {filtered.length === 0 ? (
        <div className="kh-ops-empty-state">
          <div className="kh-ops-empty-mark">00</div>
          <h3>{t('emptyTitle')}</h3>
          <p>{query.trim() ? t('emptyFiltered') : t('empty')}</p>
        </div>
      ) : (
        <div className="kh-ops-table-wrap">
          <table className="kh-ops-data-table kh-ops-delivery-list">
            <thead>
              <tr>
                {columns.map((column) => (
                  <th
                    key={column.key}
                    className={column.numeric ? 'kh-ops-num' : undefined}
                  >
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
              {filtered.map((row) => {
                const statusOptions =
                  row.kind === 'task' ? TASK_STATUSES : MILESTONE_STATUSES;
                const forecast = toHours(row.forecastHours);
                const actual = toHours(row.actualHours);
                return (
                  <tr key={row.id}>
                    <td>
                      <span className="kh-ops-type-chip">
                        {row.humanKey ?? t(KIND_LABEL[row.kind])}
                      </span>
                    </td>
                    <td className="kh-ops-primary-cell">
                      <button
                        type="button"
                        className="border-0 bg-transparent p-0 text-left text-inherit"
                        onClick={() => onManage(row.kind, row.entityId)}
                      >
                        {row.title}
                      </button>
                    </td>
                    <td>
                      {canMutate ? (
                        <Select
                          className="h-9 min-h-9 py-0 text-xs"
                          value={row.status}
                          disabled={pending}
                          aria-label={t('filterStatus')}
                          onChange={(event) =>
                            onStatusChange(row.kind, row.entityId, event.target.value)
                          }
                        >
                          {statusOptions.map((status) => (
                            <option key={status} value={status}>
                              {row.kind === 'task'
                                ? t(`taskStatus.${status}`)
                                : t(`milestoneStatus.${status}`)}
                            </option>
                          ))}
                        </Select>
                      ) : (
                        <span>
                          {row.kind === 'task'
                            ? t(`taskStatus.${row.status}`)
                            : t(`milestoneStatus.${row.status}`)}
                        </span>
                      )}
                    </td>
                    <td>{row.owner ?? '—'}</td>
                    <td>{row.sprint ?? '—'}</td>
                    <td className="kh-ops-num">
                      {forecast == null ? '—' : forecast}
                    </td>
                    <td className="kh-ops-num">
                      {actual == null ? '—' : actual}
                    </td>
                    <td className="kh-ops-num">
                      {row.storyPoints == null ? '—' : row.storyPoints}
                    </td>
                    <td>
                      <div className="flex items-center justify-between gap-3">
                        <span>{row.updatedAt ?? '—'}</span>
                        <Button
                          type="button"
                          variant="secondary"
                          className="h-8 min-h-8 px-2 text-xs"
                          onClick={() => onManage(row.kind, row.entityId)}
                        >
                          {t('manage')}
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

