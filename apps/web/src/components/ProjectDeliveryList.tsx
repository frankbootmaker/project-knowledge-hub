'use client';

import { useMemo, useRef } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { DataTable, type DataColumn } from './ui/DataTable';
import { Button, Input, Select } from './ui';
import {
  applyTableView,
  collectEnumOptions,
  compareText,
} from '../lib/data-table';
import { useSyncEnumFilters, useTableState } from '../lib/use-table-state';
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

const MILESTONE_STATUSES = ['planned', 'active', 'done', 'cancelled'] as const;
const TASK_STATUSES = ['todo', 'in_progress', 'blocked', 'done', 'cancelled'] as const;
const DELIVERY_STATUS_RANK: Record<string, number> = {
  planned: 0,
  todo: 1,
  active: 2,
  in_progress: 3,
  blocked: 4,
  done: 5,
  cancelled: 6,
};
const KIND_LABEL = {
  epic: 'kindEpic',
  story: 'kindStory',
  milestone: 'kindMilestone',
  task: 'kindTask',
} as const;

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
  const tTable = useTranslations('table');
  const locale = useLocale();
  const onManageRef = useRef(onManage);
  const onStatusChangeRef = useRef(onStatusChange);
  onManageRef.current = onManage;
  onStatusChangeRef.current = onStatusChange;
  const table = useTableState({
    namespace: 'dl',
    defaultSortKey: 'updated',
    defaultSortDir: 'desc',
  });

  const statusOptions = useMemo(
    () =>
      Object.keys(DELIVERY_STATUS_RANK).map((value) => ({
        value,
        label: (TASK_STATUSES as readonly string[]).includes(value)
          ? t(`taskStatus.${value}`)
          : t(`milestoneStatus.${value}`),
      })),
    [t],
  );
  const ownerOptions = useMemo(
    () =>
      collectEnumOptions(
        rows,
        (row) => row.owner ?? '',
        (value) => value,
        locale,
      ),
    [locale, rows],
  );
  const sprintOptions = useMemo(
    () =>
      collectEnumOptions(
        rows,
        (row) => row.sprint ?? '',
        (value) => value,
        locale,
      ),
    [locale, rows],
  );

  const columns = useMemo<Array<DataColumn<DeliveryListRow>>>(() => [
    {
      id: 'id',
      header: t('colId'),
      kind: 'data',
      sort: { type: 'text', getValue: (row) => row.humanKey ?? '' },
      cell: (row) => (
        <span className="kh-ops-type-chip">
          {row.humanKey ?? t(KIND_LABEL[row.kind])}
        </span>
      ),
    },
    {
      id: 'title',
      header: t('colTitle'),
      kind: 'text',
      primary: true,
      sort: { type: 'text', getValue: (row) => row.title },
      filter: { type: 'text', getValue: (row) => row.title },
      cell: (row) => (
        <button
          type="button"
          className="border-0 bg-transparent p-0 text-left text-inherit"
          onClick={() => onManageRef.current(row.kind, row.entityId)}
        >
          {row.title}
        </button>
      ),
    },
    {
      id: 'status',
      header: t('colStatus'),
      kind: 'status',
      sort: {
        type: 'number',
        getValue: (row) => DELIVERY_STATUS_RANK[row.status] ?? 99,
      },
      filter: {
        type: 'enum',
        getValue: (row) => row.status,
        options: statusOptions,
      },
      cell: (row) => {
        const statusOptionsForRow =
          row.kind === 'task' ? TASK_STATUSES : MILESTONE_STATUSES;
        if (!canMutate) {
          return (
            <span>
              {row.kind === 'task'
                ? t(`taskStatus.${row.status}`)
                : t(`milestoneStatus.${row.status}`)}
            </span>
          );
        }
        return (
          <Select
            className="h-9 min-h-9 py-0 text-xs"
            value={row.status}
            disabled={pending}
            aria-label={t('rowStatus', { item: row.title })}
            onChange={(event) =>
              onStatusChangeRef.current(row.kind, row.entityId, event.target.value)
            }
          >
            {statusOptionsForRow.map((status) => (
              <option key={status} value={status}>
                {row.kind === 'task'
                  ? t(`taskStatus.${status}`)
                  : t(`milestoneStatus.${status}`)}
              </option>
            ))}
          </Select>
        );
      },
    },
    {
      id: 'owner',
      header: t('colOwner'),
      kind: 'text',
      sort: { type: 'text', getValue: (row) => row.owner ?? '' },
      filter: {
        type: 'enum',
        getValue: (row) => row.owner ?? '',
        options: ownerOptions,
      },
      cell: (row) => row.owner ?? '—',
    },
    {
      id: 'sprint',
      header: t('colSprint'),
      kind: 'data',
      sort: { type: 'text', getValue: (row) => row.sprint ?? '' },
      filter: {
        type: 'enum',
        getValue: (row) => row.sprint ?? '',
        options: sprintOptions,
      },
      cell: (row) => row.sprint ?? '—',
    },
    {
      id: 'forecast',
      header: t('colForecast'),
      kind: 'number',
      sort: {
        type: 'number',
        getValue: (row) => hoursValue(row.forecastHours),
        defaultDir: 'desc',
      },
      cell: (row) => {
        const forecast = toHours(row.forecastHours);
        return forecast == null ? '—' : forecast;
      },
    },
    {
      id: 'actual',
      header: t('colActual'),
      kind: 'number',
      sort: {
        type: 'number',
        getValue: (row) => hoursValue(row.actualHours),
        defaultDir: 'desc',
      },
      cell: (row) => {
        const actual = toHours(row.actualHours);
        return actual == null ? '—' : actual;
      },
    },
    {
      id: 'points',
      header: t('colPoints'),
      kind: 'number',
      sort: {
        type: 'number',
        getValue: (row) => row.storyPoints ?? -1,
        defaultDir: 'desc',
      },
      cell: (row) => (row.storyPoints == null ? '—' : row.storyPoints),
    },
    {
      id: 'updated',
      header: t('colUpdated'),
      kind: 'date',
      sort: {
        type: 'date',
        getValue: (row) => row.updatedAt ?? '',
        defaultDir: 'desc',
      },
      cell: (row) => row.updatedAt ?? '—',
    },
    {
      id: 'manage',
      header: '',
      kind: 'actions',
      cell: (row) => (
        <Button
          type="button"
          variant="secondary"
          className="h-8 min-h-8 px-2 text-xs"
          onClick={() => onManageRef.current(row.kind, row.entityId)}
        >
          {t('manage')}
        </Button>
      ),
    },
  ], [
    canMutate,
    ownerOptions,
    pending,
    sprintOptions,
    statusOptions,
    t,
  ]);
  useSyncEnumFilters(table.filters, columns, table.setEnumFilter);

  const visible = useMemo(() => applyTableView({
    rows,
    locale,
    query: table.query,
    search: (row, needle) => row.searchText.includes(needle),
    sortKey: table.sortKey,
    sortDir: table.sortDir,
    filters: table.filters,
    textFilters: table.textFilters,
    columns,
    tieBreak: (a, b) => compareText(a.title, b.title, locale),
  }), [
    columns,
    locale,
    rows,
    table.filters,
    table.query,
    table.sortDir,
    table.sortKey,
    table.textFilters,
  ]);
  const bareEmpty = visible.length === 0 && !table.filtersActive;

  return (
    <section className="kh-ops-panel">
      <div className="kh-ops-toolbar mb-0 border-0 border-b border-line">
        <label className="flex min-w-[220px] flex-1 items-center gap-2">
          <span className="sr-only">{t('searchPlaceholder')}</span>
          <Input
            type="search"
            value={table.query}
            onChange={(event) => table.setQuery(event.target.value)}
            placeholder={t('searchPlaceholder')}
            className="h-10 min-h-10 py-1.5 text-xs"
          />
        </label>
      </div>
      {bareEmpty ? (
        <div className="kh-ops-empty-state">
          <div className="kh-ops-empty-mark">00</div>
          <h3>{t('emptyTitle')}</h3>
          <p>{table.query.trim() ? t('emptyFiltered') : t('empty')}</p>
        </div>
      ) : (
        <DataTable
          rows={visible}
          rowKey={(row) => row.id}
          columns={columns}
          sortKey={table.sortKey}
          sortDir={table.sortDir}
          onToggleSort={table.toggleSort}
          enumFilters={table.filters}
          textFilters={table.textFilters}
          onEnumFilter={table.setEnumFilter}
          onTextFilter={table.setTextFilter}
          onClearFilters={table.clearFilters}
          filtersActive={table.filtersActive}
          tableClassName="kh-ops-delivery-list"
          empty={
            <>
              <h3>{t('emptyTitle')}</h3>
              <p>{tTable('emptyFiltered')}</p>
            </>
          }
        />
      )}
    </section>
  );
}
