'use client';

import { useEffect, useMemo } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { DataTable, type DataColumn } from './ui/DataTable';
import { Badge, Button, Input, raidSeverityTone } from './ui';
import {
  applyTableView,
  collectEnumOptions,
  compareText,
} from '../lib/data-table';
import { useSyncEnumFilters, useTableState } from '../lib/use-table-state';
import type { RaidItem } from './ProjectRaidPanel';

const KINDS = ['risk', 'assumption', 'issue', 'dependency'] as const;
const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;
const STATUSES = ['open', 'mitigating', 'accepted', 'closed', 'cancelled'] as const;
const SEVERITY_RANK = rankMap(SEVERITIES);
const STATUS_RANK = rankMap(STATUSES);

function rankMap(order: readonly string[]): Record<string, number> {
  return Object.fromEntries(order.map((value, index) => [value, index]));
}

export function ProjectRaidList({
  items,
  canMutate,
  onManage,
  onCreate,
}: {
  items: RaidItem[];
  canMutate: boolean;
  onManage: (id: string) => void;
  onCreate: () => void;
}) {
  const t = useTranslations('raid');
  const tTable = useTranslations('table');
  const locale = useLocale();
  const table = useTableState({
    namespace: 'raid',
    defaultSortKey: 'id',
    defaultSortDir: 'desc',
  });
  const selectedKinds = table.filters.kind ?? [];

  useEffect(() => {
    const legacy = table.extras.kind;
    if (!legacy) return;
    if (
      (KINDS as readonly string[]).includes(legacy) &&
      selectedKinds.length === 0
    ) {
      table.setEnumFilter('kind', [legacy]);
    }
    table.setExtra('kind', '');
  }, [selectedKinds.length, table.extras.kind, table.setEnumFilter, table.setExtra]);

  const kindOptions = useMemo(
    () => KINDS.map((value) => ({ value, label: t(`kind.${value}`) })),
    [t],
  );
  const severityOptions = useMemo(
    () => SEVERITIES.map((value) => ({ value, label: t(`severity.${value}`) })),
    [t],
  );
  const statusOptions = useMemo(
    () => STATUSES.map((value) => ({ value, label: t(`status.${value}`) })),
    [t],
  );
  const ownerOptions = useMemo(
    () =>
      collectEnumOptions(
        items,
        (item) => item.owner?.displayName ?? '',
        (value) => value,
        locale,
      ),
    [items, locale],
  );
  const kindLabels = useMemo(() => {
    const labels: Record<string, string> = {};
    for (const kind of KINDS) labels[kind] = t(`kind.${kind}`);
    return labels;
  }, [t]);

  const columns = useMemo<Array<DataColumn<RaidItem>>>(() => [
    {
      id: 'id',
      header: t('colId'),
      kind: 'data',
      sort: {
        type: 'text',
        getValue: (item) => item.humanKey ?? item.title,
        defaultDir: 'desc',
      },
      cell: (item) => (
        <span className="kh-ops-type-chip">
          {item.humanKey ?? t(`kind.${item.kind}`)}
        </span>
      ),
    },
    {
      id: 'kind',
      header: t('colKind'),
      kind: 'status',
      sort: {
        type: 'text',
        getValue: (item) => kindLabels[item.kind] ?? item.kind,
      },
      filter: {
        type: 'enum',
        getValue: (item) => item.kind,
        options: kindOptions,
      },
      cell: (item) => (
        <span className="kh-ops-type-chip">{t(`kind.${item.kind}`)}</span>
      ),
    },
    {
      id: 'title',
      header: t('colTitle'),
      kind: 'text',
      primary: true,
      sort: { type: 'text', getValue: (item) => item.title },
      cell: (item) => (
        <button
          type="button"
          className="border-0 bg-transparent p-0 text-left text-inherit"
          onClick={() => onManage(item.id)}
        >
          {item.title}
        </button>
      ),
    },
    {
      id: 'severity',
      header: t('colSeverity'),
      kind: 'status',
      sort: {
        type: 'number',
        getValue: (item) => SEVERITY_RANK[item.severity] ?? 99,
      },
      filter: {
        type: 'enum',
        getValue: (item) => item.severity,
        options: severityOptions,
      },
      cell: (item) => (
        <Badge tone={raidSeverityTone(item.severity)}>
          {t(`severity.${item.severity}`)}
        </Badge>
      ),
    },
    {
      id: 'status',
      header: t('colStatus'),
      kind: 'status',
      sort: {
        type: 'number',
        getValue: (item) => STATUS_RANK[item.status] ?? 99,
      },
      filter: {
        type: 'enum',
        getValue: (item) => item.status,
        options: statusOptions,
      },
      cell: (item) => t(`status.${item.status}`),
    },
    {
      id: 'owner',
      header: t('colOwner'),
      kind: 'text',
      sort: { type: 'text', getValue: (item) => item.owner?.displayName ?? '' },
      filter: {
        type: 'enum',
        getValue: (item) => item.owner?.displayName ?? '',
        options: ownerOptions,
      },
      cell: (item) => item.owner?.displayName ?? t('unassigned'),
    },
    {
      id: 'due',
      header: t('colDue'),
      kind: 'date',
      sort: {
        type: 'date',
        getValue: (item) => item.dueDate ?? '',
        defaultDir: 'desc',
      },
      cell: (item) => item.dueDate ?? '—',
    },
    {
      id: 'linked',
      header: t('colLinked'),
      kind: 'text',
      cell: (item) =>
        item.tasks.length > 0
          ? item.tasks.map((task) => task.humanKey ?? task.title).join(', ')
          : '—',
    },
    {
      id: 'manage',
      header: '',
      kind: 'actions',
      cell: (item) => (
        <Button
          type="button"
          variant="secondary"
          className="h-8 min-h-8 px-2 text-xs"
          onClick={() => onManage(item.id)}
        >
          {t('manage')}
        </Button>
      ),
    },
  ], [
    kindLabels,
    kindOptions,
    onManage,
    ownerOptions,
    severityOptions,
    statusOptions,
    t,
  ]);
  useSyncEnumFilters(table.filters, columns, table.setEnumFilter);

  const visible = useMemo(() => applyTableView({
    rows: items,
    locale,
    query: table.query,
    search: (item, needle) =>
      [
        item.title,
        item.humanKey ?? '',
        item.description ?? '',
        item.kind,
        item.status,
        item.severity,
        item.owner?.displayName ?? '',
        ...item.tasks.map((task) => task.humanKey ?? task.title),
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
    items,
    locale,
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
        <div
          className="kh-ops-delivery-modes mb-0"
          role="group"
          aria-label={t('filterLabel')}
        >
          <button
            type="button"
            aria-pressed={selectedKinds.length === 0}
            onClick={() => table.setEnumFilter('kind', [])}
          >
            {t('kindAll')}
          </button>
          {KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              aria-pressed={
                selectedKinds.length === 1 && selectedKinds[0] === kind
              }
              onClick={() => table.setEnumFilter('kind', [kind])}
            >
              {t(`kind.${kind}`)}
            </button>
          ))}
        </div>
        <label className="flex min-w-[180px] flex-1 items-center gap-2">
          <span className="sr-only">{t('searchPlaceholder')}</span>
          <Input
            type="search"
            value={table.query}
            onChange={(event) => table.setQuery(event.target.value)}
            placeholder={t('searchPlaceholder')}
            className="h-10 min-h-10 py-1.5 text-xs"
          />
        </label>
        {canMutate ? (
          <Button type="button" onClick={onCreate}>
            {t('addItem')}
          </Button>
        ) : null}
      </div>
      {bareEmpty ? (
        <div className="kh-ops-empty-state">
          <div className="kh-ops-empty-mark">00</div>
          <h3>{t('emptyTitle')}</h3>
          <p>
            {table.query.trim() || selectedKinds.length > 0
              ? t('emptyFiltered')
              : t('empty')}
          </p>
        </div>
      ) : (
        <DataTable
          rows={visible}
          rowKey={(item) => item.id}
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
