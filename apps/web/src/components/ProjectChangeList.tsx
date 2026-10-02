'use client';

import { useMemo } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { DataTable, type DataColumn } from './ui/DataTable';
import { Badge, Button, Input } from './ui';
import {
  applyTableView,
  compareText,
} from '../lib/data-table';
import { useSyncEnumFilters, useTableState } from '../lib/use-table-state';
import type { ChangeItem } from './ProjectChangePanel';

const KINDS = ['scope', 'timeline', 'stakeholder', 'budget', 'other'] as const;
const STATUSES = [
  'proposed',
  'approved',
  'rejected',
  'implemented',
  'cancelled',
] as const;
const STATUS_RANK: Record<string, number> = {
  proposed: 0,
  approved: 1,
  rejected: 2,
  implemented: 3,
  cancelled: 4,
};

export function ProjectChangeList({
  items,
  canMutate,
  onManage,
  onCreate,
}: {
  items: ChangeItem[];
  canMutate: boolean;
  onManage: (id: string) => void;
  onCreate: () => void;
}) {
  const t = useTranslations('changes');
  const tTable = useTranslations('table');
  const locale = useLocale();
  const table = useTableState({
    namespace: 'chg',
    defaultSortKey: 'id',
    defaultSortDir: 'desc',
  });

  const kindOptions = useMemo(
    () => KINDS.map((value) => ({ value, label: t(`kind.${value}`) })),
    [t],
  );
  const statusOptions = useMemo(
    () => STATUSES.map((value) => ({ value, label: t(`status.${value}`) })),
    [t],
  );
  const kindLabels = useMemo(() => {
    const labels: Record<string, string> = {};
    for (const kind of KINDS) labels[kind] = t(`kind.${kind}`);
    return labels;
  }, [t]);

  const columns = useMemo<Array<DataColumn<ChangeItem>>>(() => [
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
      cell: (item) => <Badge>{t(`status.${item.status}`)}</Badge>,
    },
    {
      id: 'requested',
      header: t('colRequestedBy'),
      kind: 'text',
      sort: {
        type: 'text',
        getValue: (item) => item.requestedBy?.displayName ?? '',
      },
      cell: (item) => item.requestedBy?.displayName ?? t('unassigned'),
    },
    {
      id: 'effective',
      header: t('colEffective'),
      kind: 'date',
      sort: {
        type: 'date',
        getValue: (item) => item.effectiveDate ?? '',
        defaultDir: 'desc',
      },
      cell: (item) => item.effectiveDate ?? '—',
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
  ], [kindLabels, kindOptions, onManage, statusOptions, t]);
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
        item.rationale ?? '',
        item.kind,
        item.status,
        item.requestedBy?.displayName ?? '',
        item.knowledgeRecordTitle ?? '',
        ...item.deliveryLinks.map((link) => link.entityTitle ?? ''),
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
          <p>{table.query.trim() ? t('emptyFiltered') : t('empty')}</p>
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
