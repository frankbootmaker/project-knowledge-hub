'use client';

import { useLocale, useTranslations } from 'next-intl';
import { DataTable, type DataColumn } from './ui/DataTable';
import { Badge, Button, Input, raidSeverityTone } from './ui';
import {
  applyTableView,
  collectEnumOptions,
  compareText,
} from '../lib/data-table';
import { useTableState } from '../lib/use-table-state';
import type { RaidItem } from './ProjectRaidPanel';

const KINDS = ['risk', 'assumption', 'issue', 'dependency'] as const;
const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
const STATUSES = ['open', 'mitigating', 'accepted', 'closed', 'cancelled'] as const;

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
  const kindFilter = table.extras.kind ?? 'all';

  const severityOptions = collectEnumOptions(
    items,
    (item) => item.severity,
    (value) =>
      (SEVERITIES as readonly string[]).includes(value)
        ? t(`severity.${value}`)
        : value,
    locale,
  );
  const statusOptions = collectEnumOptions(
    items,
    (item) => item.status,
    (value) =>
      (STATUSES as readonly string[]).includes(value)
        ? t(`status.${value}`)
        : value,
    locale,
  );
  const ownerOptions = collectEnumOptions(
    items,
    (item) => item.owner?.displayName ?? '',
    (value) => value,
    locale,
  );

  const columns: Array<DataColumn<RaidItem>> = [
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
      sort: { type: 'text', getValue: (item) => t(`kind.${item.kind}`) },
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
      sort: { type: 'text', getValue: (item) => item.severity },
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
      sort: { type: 'text', getValue: (item) => item.status },
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
  ];

  const kindScoped =
    kindFilter === 'all'
      ? items
      : items.filter((item) => item.kind === kindFilter);
  const visible = applyTableView({
    rows: kindScoped,
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
  });
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
            aria-pressed={kindFilter === 'all'}
            onClick={() => table.setExtra('kind', '')}
          >
            {t('kindAll')}
          </button>
          {KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              aria-pressed={kindFilter === kind}
              onClick={() => table.setExtra('kind', kind)}
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
            {table.query.trim() || kindFilter !== 'all'
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
