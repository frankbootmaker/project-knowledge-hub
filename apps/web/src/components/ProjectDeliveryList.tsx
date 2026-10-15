'use client';

import { useMemo, useRef } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { LocalDateTime } from './LocalDateTime';
import { MilestoneTimeMarkers } from './MilestoneTimeMarkers';
import { DataTable, type DataColumn } from './ui/DataTable';
import { Button, Input, Select } from './ui';
import {
  applyTableView,
  collectEnumOptions,
  compareText,
} from '../lib/data-table';
import { useSyncEnumFilters, useTableState } from '../lib/use-table-state';
import {
  DELIVERY_STATUS_RANK,
  MILESTONE_STATUSES,
  TASK_STATUSES,
  isTaskDeliveryStatus,
} from '../lib/delivery-status';
import { toHours } from '../lib/task-costing';
import {
  deliveryLag,
  deliveryPaceClass,
  formatPercentLabel,
  formatStableNumber,
  type DeliveryCompletion,
} from '../lib/delivery-completion';

export type DeliveryListKind = 'epic' | 'story' | 'milestone' | 'task';

export type DeliveryListRow = {
  id: string;
  kind: DeliveryListKind;
  entityId: string;
  humanKey: string | null;
  itemType?: 'task' | 'bug' | null;
  title: string;
  status: string;
  completion: DeliveryCompletion | null;
  /** Plan percent for today. Stories and epics only. */
  targetPercent: number | null;
  owner: string | null;
  sprint: string | null;
  forecastHours: string | number | null;
  actualHours: string | number | null;
  storyPoints: number | null;
  updatedAt: string | null;
  dueDate?: string | null;
  searchText: string;
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
        label: isTaskDeliveryStatus(value)
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
      cell: (row) => {
        const key = row.humanKey;
        const label =
          row.kind === 'task' && row.itemType === 'bug'
            ? (key ?? t('kindBug'))
            : (key ?? t(KIND_LABEL[row.kind]));
        return <span className={key ? 'kh-ops-key-badge' : 'kh-ops-type-chip'}>{label}</span>;
      },
    },
    {
      id: 'type',
      header: t('colType'),
      kind: 'data',
      sort: {
        type: 'text',
        getValue: (row) =>
          row.kind === 'task' && row.itemType === 'bug' ? 'bug' : row.kind,
      },
      filter: {
        type: 'enum',
        getValue: (row) =>
          row.kind === 'task' && row.itemType === 'bug' ? 'bug' : row.kind,
        options: [
          { value: 'task', label: t('kindTask') },
          { value: 'bug', label: t('kindBug') },
          { value: 'epic', label: t('kindEpic') },
          { value: 'story', label: t('kindStory') },
          { value: 'milestone', label: t('kindMilestone') },
        ],
      },
      cell: (row) =>
        row.kind === 'task' && row.itemType === 'bug'
          ? t('kindBug')
          : t(KIND_LABEL[row.kind]),
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
            className="kh-ops-inline-select h-9 min-h-9 py-0 text-xs"
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
      id: 'complete',
      header: t('colComplete'),
      headerLabel: t('colCompleteLabel'),
      kind: 'number',
      sort: {
        type: 'number',
        getValue: (row) => row.completion?.percent ?? -1,
        defaultDir: 'desc',
      },
      cell: (row) => {
        const comparable = row.kind === 'epic' || row.kind === 'story' || row.kind === 'milestone';
        const lag = comparable
          ? deliveryLag({
              actual: row.completion?.percent ?? null,
              target: row.targetPercent,
              status: row.status,
            })
          : null;
        const earnedTitle =
          comparable && row.completion
            ? t('completeOf', {
                done: formatStableNumber(row.completion.done, locale),
                total: row.completion.total,
              })
            : null;
        const lagTitle = lag
          ? t(lag === 'overdue' ? 'completeOverdue' : 'completeBehind', {
              gap: (row.targetPercent ?? 0) - (row.completion?.percent ?? 0),
            })
          : null;
        const title = [earnedTitle, lagTitle].filter(Boolean).join(' · ') || undefined;
        const label = row.completion
          ? formatPercentLabel(row.completion.percent, locale)
          : '—';
        if (!title) return label;
        return (
          <span className={deliveryPaceClass(lag)} title={title}>
            {label}
          </span>
        );
      },
    },
    {
      id: 'target',
      header: t('colTarget'),
      headerLabel: t('colTargetLabel'),
      kind: 'number',
      sort: {
        type: 'number',
        getValue: (row) => row.targetPercent ?? -1,
        defaultDir: 'desc',
      },
      cell: (row) =>
        row.targetPercent == null
          ? '—'
          : formatPercentLabel(row.targetPercent, locale),
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
      kind: 'text',
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
      cell: (row) =>
        row.updatedAt ? (
          <LocalDateTime value={row.updatedAt} dateOnly locale={locale} />
        ) : (
          '—'
        ),
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
    locale,
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

  const milestoneMarkers = useMemo(
    () =>
      rows
        .filter((row) => row.kind === 'milestone')
        .map((row) => ({
          id: row.entityId,
          title: row.title,
          status: row.status,
          targetDate: row.dueDate ?? null,
          humanKey: row.humanKey,
          completionPercent: row.completion?.percent ?? null,
        })),
    [rows],
  );

  return (
    <section className="kh-ops-panel">
      <MilestoneTimeMarkers
        milestones={milestoneMarkers}
        onManage={(milestoneId) => onManageRef.current('milestone', milestoneId)}
      />
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
