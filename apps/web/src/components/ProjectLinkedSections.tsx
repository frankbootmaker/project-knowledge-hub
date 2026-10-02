'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { DataTable, type DataColumn } from './ui/DataTable';
import { Input, LinkButton, lifecycleLabel } from './ui';
import { CollapsibleSection } from './CollapsibleSection';
import {
  applyTableView,
  collectEnumOptions,
  compareText,
} from '../lib/data-table';
import { useTableState } from '../lib/use-table-state';
import {
  groupRecordsByTranslationFamily,
  normalizeContentLanguage,
  pickPreferredRecord,
} from '../lib/translation-families';

export type ProjectLinkedSystem = {
  id: string;
  name: string;
  slug: string;
  status: string;
  summary?: string | null;
  tags?: Array<{ name: string }>;
  updatedAt?: string | null;
};

export type ProjectLinkedRecord = {
  id: string;
  title: string;
  slug: string;
  recordType: string;
  humanKey?: string | null;
  lifecycleStatus: string;
  language?: string | null;
  translationGroupId?: string | null;
  summary?: string | null;
  updatedAt: string;
};

type RecordFamily = {
  family: ProjectLinkedRecord[];
  preferred: ProjectLinkedRecord;
  languages: string[];
};

function formatUpdated(value: string | null | undefined, locale: string): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function ProjectLinkedSections({
  workspaceSlug,
  projectId,
  systems,
  records,
  canMutate,
}: {
  workspaceSlug: string;
  projectId: string;
  systems: ProjectLinkedSystem[];
  records: ProjectLinkedRecord[];
  canMutate: boolean;
}) {
  const t = useTranslations('projects');
  const tWorkspaces = useTranslations('workspaces');
  const tRecords = useTranslations('records');
  const tTable = useTranslations('table');
  const locale = useLocale();
  const systemsTable = useTableState({
    namespace: 'lsys',
    defaultSortKey: null,
  });
  const recordsTable = useTableState({
    namespace: 'lkno',
    defaultSortKey: null,
  });

  const recordFamilies = useMemo<RecordFamily[]>(
    () =>
      groupRecordsByTranslationFamily(records).map((family) => {
        const preferred = pickPreferredRecord(family, locale);
        const languages = [
          ...new Set(
            family.map((record) => normalizeContentLanguage(record.language)),
          ),
        ].sort((a, b) => a.localeCompare(b));
        return { family, preferred, languages };
      }),
    [locale, records],
  );

  const systemStatusOptions = collectEnumOptions(
    systems,
    (system) => system.status,
    (value) => value,
    locale,
  );
  const typeOptions = collectEnumOptions(
    recordFamilies,
    (row) => row.preferred.recordType,
    (value) => value,
    locale,
  );
  const languageOptions = collectEnumOptions(
    recordFamilies,
    (row) => row.languages,
    (value) => value,
    locale,
  );
  const lifecycleOptions = collectEnumOptions(
    recordFamilies,
    (row) => row.preferred.lifecycleStatus,
    (value) => lifecycleLabel(value, tRecords),
    locale,
  );

  const systemColumns: Array<DataColumn<ProjectLinkedSystem>> = [
    {
      id: 'name',
      header: tWorkspaces('colName'),
      kind: 'text',
      primary: true,
      sort: { type: 'text', getValue: (system) => system.name },
      cell: (system) => (
        <Link
          href={`/workspaces/${workspaceSlug}/systems/${system.slug}`}
          className="no-underline"
        >
          {system.name}
        </Link>
      ),
    },
    {
      id: 'status',
      header: tWorkspaces('colStatus'),
      kind: 'status',
      sort: { type: 'text', getValue: (system) => system.status },
      filter: {
        type: 'enum',
        getValue: (system) => system.status,
        options: systemStatusOptions,
      },
      cell: (system) => (
        <span className="kh-ops-type-chip">{system.status}</span>
      ),
    },
    {
      id: 'updated',
      header: tWorkspaces('colUpdated'),
      kind: 'date',
      sort: {
        type: 'date',
        getValue: (system) => system.updatedAt ?? '',
        defaultDir: 'desc',
      },
      cell: (system) => formatUpdated(system.updatedAt, locale),
    },
  ];

  const recordColumns: Array<DataColumn<RecordFamily>> = [
    {
      id: 'key',
      header: tWorkspaces('colKey'),
      kind: 'data',
      sort: {
        type: 'text',
        getValue: (row) => row.preferred.humanKey ?? row.preferred.recordType,
      },
      cell: (row) => (
        <span className="kh-ops-type-chip">
          {row.preferred.humanKey ?? row.preferred.recordType}
        </span>
      ),
    },
    {
      id: 'title',
      header: tWorkspaces('colTitle'),
      kind: 'text',
      primary: true,
      sort: { type: 'text', getValue: (row) => row.preferred.title },
      cell: (row) => (
        <Link
          href={`/workspaces/${workspaceSlug}/records/${row.preferred.slug}`}
          className="no-underline"
        >
          {row.preferred.title}
        </Link>
      ),
    },
    {
      id: 'type',
      header: tWorkspaces('colType'),
      kind: 'data',
      sort: { type: 'text', getValue: (row) => row.preferred.recordType },
      filter: {
        type: 'enum',
        getValue: (row) => row.preferred.recordType,
        options: typeOptions,
      },
      cell: (row) => row.preferred.recordType,
    },
    {
      id: 'language',
      header: tWorkspaces('colLanguage'),
      kind: 'data',
      sort: {
        type: 'text',
        getValue: (row) => row.languages.join(', '),
      },
      filter: {
        type: 'enum',
        getValue: (row) => row.languages,
        options: languageOptions,
      },
      cell: (row) => row.languages.join(', '),
    },
    {
      id: 'lifecycle',
      header: tWorkspaces('colLifecycle'),
      kind: 'status',
      sort: {
        type: 'text',
        getValue: (row) => lifecycleLabel(row.preferred.lifecycleStatus, tRecords),
      },
      filter: {
        type: 'enum',
        getValue: (row) => row.preferred.lifecycleStatus,
        options: lifecycleOptions,
      },
      cell: (row) => lifecycleLabel(row.preferred.lifecycleStatus, tRecords),
    },
    {
      id: 'updated',
      header: tWorkspaces('colUpdated'),
      kind: 'date',
      sort: {
        type: 'date',
        getValue: (row) => row.preferred.updatedAt,
        defaultDir: 'desc',
      },
      cell: (row) => formatUpdated(row.preferred.updatedAt, locale),
    },
  ];

  const visibleSystems = applyTableView({
    rows: systems,
    locale,
    query: systemsTable.query,
    search: (system, needle) =>
      [system.name, system.slug, system.summary ?? '', system.status]
        .join(' ')
        .toLowerCase()
        .includes(needle),
    sortKey: systemsTable.sortKey,
    sortDir: systemsTable.sortDir,
    filters: systemsTable.filters,
    textFilters: systemsTable.textFilters,
    columns: systemColumns,
    tieBreak: (a, b) => compareText(a.name, b.name, locale),
  });
  const visibleRecords = applyTableView({
    rows: recordFamilies,
    locale,
    query: recordsTable.query,
    search: (row, needle) =>
      row.family
        .flatMap((record) => [
          record.title,
          record.slug,
          record.recordType,
          record.humanKey ?? '',
          record.lifecycleStatus,
          normalizeContentLanguage(record.language),
          record.summary ?? '',
          row.preferred.title,
        ])
        .join(' ')
        .toLowerCase()
        .includes(needle),
    sortKey: recordsTable.sortKey,
    sortDir: recordsTable.sortDir,
    filters: recordsTable.filters,
    textFilters: recordsTable.textFilters,
    columns: recordColumns,
    tieBreak: (a, b) => compareText(a.preferred.title, b.preferred.title, locale),
  });

  const systemsBare =
    visibleSystems.length === 0 && !systemsTable.filtersActive;
  const recordsBare =
    visibleRecords.length === 0 && !recordsTable.filtersActive;

  return (
    <>
      <CollapsibleSection
        id="project-systems"
        storageKey={`project:${projectId}:systems`}
        title={t('linkedSystems')}
        defaultOpen
      >
        <section className="kh-ops-panel">
          <div className="kh-ops-toolbar mb-0 border-0 border-b border-line">
            <Input
              type="search"
              value={systemsTable.query}
              onChange={(event) => systemsTable.setQuery(event.target.value)}
              placeholder={tWorkspaces('sectionSearchSystems')}
              className="h-10 min-h-10 min-w-[220px] flex-1 py-1.5 text-xs"
            />
            {canMutate ? (
              <LinkButton href={`/workspaces/${workspaceSlug}/systems/new`}>
                {tWorkspaces('newSystem')}
              </LinkButton>
            ) : null}
          </div>
          {systemsBare ? (
            <p className="kh-ops-empty">
              {systemsTable.query.trim()
                ? tWorkspaces('sectionEmptyFiltered')
                : t('noLinkedSystems')}
            </p>
          ) : (
            <DataTable
              rows={visibleSystems}
              rowKey={(system) => system.id}
              columns={systemColumns}
              sortKey={systemsTable.sortKey}
              sortDir={systemsTable.sortDir}
              onToggleSort={systemsTable.toggleSort}
              enumFilters={systemsTable.filters}
              textFilters={systemsTable.textFilters}
              onEnumFilter={systemsTable.setEnumFilter}
              onTextFilter={systemsTable.setTextFilter}
              onClearFilters={systemsTable.clearFilters}
              filtersActive={systemsTable.filtersActive}
              empty={<p>{tTable('emptyFiltered')}</p>}
            />
          )}
        </section>
      </CollapsibleSection>
      <CollapsibleSection
        id="project-knowledge"
        storageKey={`project:${projectId}:records`}
        title={t('linkedKnowledge')}
        defaultOpen
      >
        <section className="kh-ops-panel">
          <div className="kh-ops-toolbar mb-0 border-0 border-b border-line">
            <Input
              type="search"
              value={recordsTable.query}
              onChange={(event) => recordsTable.setQuery(event.target.value)}
              placeholder={tWorkspaces('sectionSearchRecords')}
              className="h-10 min-h-10 min-w-[220px] flex-1 py-1.5 text-xs"
            />
            {canMutate ? (
              <LinkButton href={`/workspaces/${workspaceSlug}/records/new`}>
                {tWorkspaces('newRecord')}
              </LinkButton>
            ) : null}
          </div>
          {recordsBare ? (
            <p className="kh-ops-empty">
              {recordsTable.query.trim()
                ? tWorkspaces('sectionEmptyFiltered')
                : t('noLinkedKnowledge')}
            </p>
          ) : (
            <DataTable
              rows={visibleRecords}
              rowKey={(row) => row.preferred.translationGroupId ?? row.preferred.id}
              columns={recordColumns}
              sortKey={recordsTable.sortKey}
              sortDir={recordsTable.sortDir}
              onToggleSort={recordsTable.toggleSort}
              enumFilters={recordsTable.filters}
              textFilters={recordsTable.textFilters}
              onEnumFilter={recordsTable.setEnumFilter}
              onTextFilter={recordsTable.setTextFilter}
              onClearFilters={recordsTable.clearFilters}
              filtersActive={recordsTable.filtersActive}
              empty={<p>{tTable('emptyFiltered')}</p>}
            />
          )}
        </section>
      </CollapsibleSection>
    </>
  );
}
