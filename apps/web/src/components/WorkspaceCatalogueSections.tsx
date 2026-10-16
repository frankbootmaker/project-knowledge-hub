'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Badge, Button, Input, LinkButton, Select, lifecycleLabel } from './ui';
import { ProjectAiCreatedBadge, ProjectStageBadge } from './ProjectStageBadge';
import { isProjectStage } from '../lib/project-stage';
import { LocalDateTime } from './LocalDateTime';
import { ImportTypePickerButton } from './ImportTypePickerButton';
import { CollapsibleSection } from './CollapsibleSection';
import { TableFilterControl, type TableFilterField } from './ui/TableFilterControl';
import { recordHref } from '../lib/record-href';
import {
  applyTableView,
  collectEnumOptions,
  compareText,
  type TableColumnSpec,
} from '../lib/data-table';
import { useSyncEnumFilters, useTableState } from '../lib/use-table-state';
import {
  groupRecordsByTranslationFamily,
  normalizeContentLanguage,
  pickPreferredRecord,
} from '../lib/translation-families';

export type { CatalogueListItem } from './CatalogueSection';

export type WorkspaceCatalogueProject = {
  id: string;
  name: string;
  slug: string;
  status: string;
  summary: string | null;
  createdVia?: string | null;
  generatedByModel?: string | null;
  tags: Array<{ name: string }>;
  updatedAt: string;
  overallRag?: 'green' | 'amber' | 'red';
};

export type WorkspaceCatalogueSystem = {
  id: string;
  name: string;
  slug: string;
  status: string;
  projectId: string | null;
  summary: string | null;
  tags: Array<{ name: string }>;
  updatedAt: string;
};

export type WorkspaceCatalogueRecord = {
  id: string;
  title: string;
  slug: string;
  recordType: string;
  humanKey?: string | null;
  lifecycleStatus: string;
  language?: string | null;
  translationGroupId?: string | null;
  summary: string | null;
  systemId: string | null;
  updatedAt: string;
};

type RecordFamily = {
  family: WorkspaceCatalogueRecord[];
  preferred: WorkspaceCatalogueRecord;
  languages: string[];
};

const DEFAULT_PAGE_SIZE = 5;
const PAGE_SIZE_OPTIONS = [5, 10, 25, 50] as const;
type PageSizeOption = (typeof PAGE_SIZE_OPTIONS)[number];

function isPageSizeOption(value: number): value is PageSizeOption {
  return (PAGE_SIZE_OPTIONS as readonly number[]).includes(value);
}

function ragTone(
  rag: 'green' | 'amber' | 'red',
): 'success' | 'warn' | 'danger' {
  if (rag === 'red') return 'danger';
  if (rag === 'amber') return 'warn';
  return 'success';
}

function pageSlice<T>(items: T[], page: number, pageSize: number) {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize) || 1);
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const pageStart = (currentPage - 1) * pageSize;
  return {
    pageItems: items.slice(pageStart, pageStart + pageSize),
    currentPage,
    totalPages,
    rangeFrom: items.length === 0 ? 0 : pageStart + 1,
    rangeTo: Math.min(pageStart + pageSize, items.length),
  };
}

function SectionPager({
  title,
  total,
  page,
  pageSize,
  onPage,
  onPageSize,
}: {
  title: string;
  total: number;
  page: number;
  pageSize: PageSizeOption;
  onPage: (page: number) => void;
  onPageSize: (size: PageSizeOption) => void;
}) {
  const t = useTranslations('workspaces');
  if (total === 0) return null;
  const { currentPage, totalPages, rangeFrom, rangeTo } = pageSlice(
    Array.from({ length: total }),
    page,
    pageSize,
  );
  return (
    <div className="kh-ops-card-foot kh-ops-catalogue-pager">
      <p className="m-0 text-ink-muted">
        {t('sectionShowing', { from: rangeFrom, to: rangeTo, total })}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={String(pageSize)}
          onChange={(event) => {
            const parsed = Number(event.target.value);
            onPageSize(isPageSizeOption(parsed) ? parsed : DEFAULT_PAGE_SIZE);
          }}
          aria-label={t('sectionPageSize')}
          className="h-10 min-h-10 w-auto min-w-[9rem] py-1.5"
        >
          {PAGE_SIZE_OPTIONS.map((size) => (
            <option key={size} value={String(size)}>
              {t('sectionPageSizeOption', { count: size })}
            </option>
          ))}
        </Select>
        {totalPages > 1 ? (
          <nav className="flex flex-wrap items-center gap-2" aria-label={title}>
            <Button
              type="button"
              variant="secondary"
              disabled={currentPage <= 1}
              onClick={() => onPage(Math.max(1, currentPage - 1))}
            >
              {t('sectionPrevPage')}
            </Button>
            <span className="kh-page-num-active" aria-current="page">
              {currentPage} / {totalPages}
            </span>
            <Button
              type="button"
              variant="secondary"
              disabled={currentPage >= totalPages}
              onClick={() => onPage(Math.min(totalPages, currentPage + 1))}
            >
              {t('sectionNextPage')}
            </Button>
          </nav>
        ) : null}
      </div>
    </div>
  );
}

export function WorkspaceCatalogueSections({
  workspaceSlug,
  projects,
  systems,
  records,
  canMutate,
}: {
  workspaceSlug: string;
  projects: WorkspaceCatalogueProject[];
  systems: WorkspaceCatalogueSystem[];
  records: WorkspaceCatalogueRecord[];
  canMutate: boolean;
}) {
  const t = useTranslations('workspaces');
  const tProjects = useTranslations('projects');
  const tRecords = useTranslations('records');
  const tTable = useTranslations('table');
  const locale = useLocale();
  const projectsTable = useTableState({ namespace: 'wproj', defaultSortKey: null });
  const systemsTable = useTableState({ namespace: 'wsys', defaultSortKey: null });
  const recordsTable = useTableState({ namespace: 'wrec', defaultSortKey: null });
  const [projectPage, setProjectPage] = useState(1);
  const [systemPage, setSystemPage] = useState(1);
  const [recordPage, setRecordPage] = useState(1);
  const [projectPageSize, setProjectPageSize] = useState<PageSizeOption>(DEFAULT_PAGE_SIZE);
  const [systemPageSize, setSystemPageSize] = useState<PageSizeOption>(DEFAULT_PAGE_SIZE);
  const [recordPageSize, setRecordPageSize] = useState<PageSizeOption>(DEFAULT_PAGE_SIZE);

  const recordFamilies = useMemo<RecordFamily[]>(
    () =>
      groupRecordsByTranslationFamily(records).map((family) => {
        const preferred = pickPreferredRecord(family, locale);
        const languages = [
          ...new Set(family.map((record) => normalizeContentLanguage(record.language))),
        ].sort((a, b) => a.localeCompare(b));
        return { family, preferred, languages };
      }),
    [locale, records],
  );

  const projectStatusOptions = useMemo(
    () =>
      collectEnumOptions(
        projects,
        (project) => project.status,
        (value) => (isProjectStage(value) ? tProjects(`stage.${value}`) : value),
        locale,
      ),
    [locale, projects, tProjects],
  );
  const projectRagOptions = useMemo(
    () =>
      collectEnumOptions(
        projects,
        (project) => project.overallRag ?? 'green',
        (value) => tProjects(`rag.${value as 'green' | 'amber' | 'red'}`),
        locale,
      ),
    [locale, projects, tProjects],
  );
  const systemStatusOptions = useMemo(
    () => collectEnumOptions(systems, (system) => system.status, (value) => value, locale),
    [locale, systems],
  );
  const systemLinkOptions = useMemo(
    () => [
      { value: 'linked', label: t('linkedToProject') },
      { value: 'independent', label: t('independent') },
    ],
    [t],
  );
  const typeOptions = useMemo(
    () =>
      collectEnumOptions(
        recordFamilies,
        (row) => row.preferred.recordType,
        (value) => value,
        locale,
      ),
    [locale, recordFamilies],
  );
  const languageOptions = useMemo(
    () => collectEnumOptions(recordFamilies, (row) => row.languages, (value) => value, locale),
    [locale, recordFamilies],
  );
  const lifecycleOptions = useMemo(() => {
    const labels = new Map<string, string>();
    for (const row of recordFamilies) {
      const status = row.preferred.lifecycleStatus;
      if (!labels.has(status)) labels.set(status, lifecycleLabel(status, tRecords));
    }
    return [...labels.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => compareText(a.label, b.label, locale));
  }, [locale, recordFamilies, tRecords]);

  const projectColumns = useMemo<Array<TableColumnSpec<WorkspaceCatalogueProject>>>(
    () => [
      {
        id: 'status',
        filter: {
          type: 'enum',
          getValue: (project) => project.status,
          options: projectStatusOptions,
        },
      },
      {
        id: 'rag',
        filter: {
          type: 'enum',
          getValue: (project) => project.overallRag ?? 'green',
          options: projectRagOptions,
        },
      },
    ],
    [projectRagOptions, projectStatusOptions],
  );
  const systemColumns = useMemo<Array<TableColumnSpec<WorkspaceCatalogueSystem>>>(
    () => [
      {
        id: 'status',
        filter: {
          type: 'enum',
          getValue: (system) => system.status,
          options: systemStatusOptions,
        },
      },
      {
        id: 'link',
        filter: {
          type: 'enum',
          getValue: (system) => (system.projectId ? 'linked' : 'independent'),
          options: systemLinkOptions,
        },
      },
    ],
    [systemLinkOptions, systemStatusOptions],
  );
  const recordColumns = useMemo<Array<TableColumnSpec<RecordFamily>>>(
    () => [
      {
        id: 'type',
        filter: {
          type: 'enum',
          getValue: (row) => row.preferred.recordType,
          options: typeOptions,
        },
      },
      {
        id: 'language',
        filter: {
          type: 'enum',
          getValue: (row) => row.languages,
          options: languageOptions,
        },
      },
      {
        id: 'lifecycle',
        filter: {
          type: 'enum',
          getValue: (row) => row.preferred.lifecycleStatus,
          options: lifecycleOptions,
        },
      },
    ],
    [languageOptions, lifecycleOptions, typeOptions],
  );
  useSyncEnumFilters(projectsTable.filters, projectColumns, projectsTable.setEnumFilter);
  useSyncEnumFilters(systemsTable.filters, systemColumns, systemsTable.setEnumFilter);
  useSyncEnumFilters(recordsTable.filters, recordColumns, recordsTable.setEnumFilter);

  const filteredProjects = useMemo(
    () =>
      applyTableView({
        rows: projects,
        locale,
        query: projectsTable.query,
        search: (project, needle) =>
          [project.name, project.slug, project.summary ?? '', project.status]
            .join(' ')
            .toLowerCase()
            .includes(needle),
        sortKey: null,
        sortDir: 'asc',
        filters: projectsTable.filters,
        textFilters: projectsTable.textFilters,
        columns: projectColumns,
      }),
    [locale, projectColumns, projects, projectsTable.filters, projectsTable.query, projectsTable.textFilters],
  );
  const filteredSystems = useMemo(
    () =>
      applyTableView({
        rows: systems,
        locale,
        query: systemsTable.query,
        search: (system, needle) =>
          [system.name, system.slug, system.summary ?? '', system.status]
            .join(' ')
            .toLowerCase()
            .includes(needle),
        sortKey: null,
        sortDir: 'asc',
        filters: systemsTable.filters,
        textFilters: systemsTable.textFilters,
        columns: systemColumns,
      }),
    [locale, systemColumns, systems, systemsTable.filters, systemsTable.query, systemsTable.textFilters],
  );
  const filteredRecords = useMemo(
    () =>
      applyTableView({
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
            ])
            .join(' ')
            .toLowerCase()
            .includes(needle),
        sortKey: null,
        sortDir: 'asc',
        filters: recordsTable.filters,
        textFilters: recordsTable.textFilters,
        columns: recordColumns,
      }),
    [
      locale,
      recordColumns,
      recordFamilies,
      recordsTable.filters,
      recordsTable.query,
      recordsTable.textFilters,
    ],
  );

  useEffect(() => {
    setProjectPage(1);
  }, [projectsTable.filters, projectsTable.query, projectsTable.textFilters]);
  useEffect(() => {
    setSystemPage(1);
  }, [systemsTable.filters, systemsTable.query, systemsTable.textFilters]);
  useEffect(() => {
    setRecordPage(1);
  }, [recordsTable.filters, recordsTable.query, recordsTable.textFilters]);

  const projectFields = useMemo<TableFilterField[]>(
    () => [
      {
        id: 'status',
        header: tProjects('stageLabel'),
        type: 'enum',
        options: projectStatusOptions,
      },
      {
        id: 'rag',
        header: tProjects('ragLabel'),
        type: 'enum',
        options: projectRagOptions,
      },
    ],
    [projectRagOptions, projectStatusOptions, t, tProjects],
  );
  const systemFields = useMemo<TableFilterField[]>(
    () => [
      { id: 'status', header: t('colStatus'), type: 'enum', options: systemStatusOptions },
      { id: 'link', header: t('colLink'), type: 'enum', options: systemLinkOptions },
    ],
    [systemLinkOptions, systemStatusOptions, t],
  );
  const recordFields = useMemo<TableFilterField[]>(
    () => [
      { id: 'type', header: t('colType'), type: 'enum', options: typeOptions },
      { id: 'language', header: t('colLanguage'), type: 'enum', options: languageOptions },
      { id: 'lifecycle', header: t('colLifecycle'), type: 'enum', options: lifecycleOptions },
    ],
    [languageOptions, lifecycleOptions, t, typeOptions],
  );

  const projectSlice = pageSlice(filteredProjects, projectPage, projectPageSize);
  const systemSlice = pageSlice(filteredSystems, systemPage, systemPageSize);
  const recordSlice = pageSlice(filteredRecords, recordPage, recordPageSize);

  function changeProjectPageSize(size: PageSizeOption) {
    setProjectPageSize(size);
    setProjectPage(1);
  }
  function changeSystemPageSize(size: PageSizeOption) {
    setSystemPageSize(size);
    setSystemPage(1);
  }
  function changeRecordPageSize(size: PageSizeOption) {
    setRecordPageSize(size);
    setRecordPage(1);
  }

  return (
    <>
      <CollapsibleSection
        storageKey={`workspace:${workspaceSlug}:projects`}
        title={t('projects')}
        defaultOpen
      >
        <section className="kh-ops-panel">
          <div className="kh-ops-toolbar mb-0 border-0 border-b border-line">
            <Input
              type="search"
              value={projectsTable.query}
              onChange={(event) => projectsTable.setQuery(event.target.value)}
              placeholder={t('sectionSearchProjects')}
              className="h-10 min-h-10 min-w-[220px] flex-1 py-1.5 text-xs"
            />
            <TableFilterControl
              fields={projectFields}
              enumFilters={projectsTable.filters}
              textFilters={projectsTable.textFilters}
              onEnumFilter={projectsTable.setEnumFilter}
              onTextFilter={projectsTable.setTextFilter}
              onClearFilters={projectsTable.clearFilters}
              filtersActive={projectsTable.filtersActive}
            />
            {projectsTable.filtersActive ? (
              <Button
                type="button"
                variant="secondary"
                className="kh-ops-tree-filter-clear h-8 min-h-8 px-2 text-xs"
                onClick={projectsTable.clearFilters}
              >
                {tTable('clearFilters')}
              </Button>
            ) : null}
            {canMutate ? (
              <LinkButton href={`/workspaces/${workspaceSlug}/projects/new`}>
                {t('newProject')}
              </LinkButton>
            ) : null}
          </div>
          {filteredProjects.length === 0 ? (
            <p className="kh-ops-empty">
              {projectsTable.query.trim() || projectsTable.filtersActive
                ? t('sectionEmptyFiltered')
                : t('noProjects')}
            </p>
          ) : (
            <div className="kh-ops-project-grid">
              {projectSlice.pageItems.map((project) => {
                const overallRag = project.overallRag ?? 'green';
                return (
                  <article key={project.id} className="kh-ops-project-card">
                    <Badge tone={ragTone(overallRag)} className="kh-ops-card-corner">
                      {tProjects(`rag.${overallRag}`)}
                    </Badge>
                    <h3>
                      <Link href={`/workspaces/${workspaceSlug}/projects/${project.slug}`}>
                        {project.name}
                      </Link>
                    </h3>
                    <p>{project.summary || t('noDescription')}</p>
                    <div className="kh-ops-project-card-foot">
                      <span className="inline-flex flex-wrap items-center gap-1">
                        <ProjectStageBadge status={project.status} />
                        <ProjectAiCreatedBadge
                          createdVia={project.createdVia}
                          generatedByModel={project.generatedByModel}
                        />
                      </span>
                      <span>
                        <LocalDateTime value={project.updatedAt} dateOnly locale={locale} />
                      </span>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
          <SectionPager
            title={t('projects')}
            total={filteredProjects.length}
            page={projectPage}
            pageSize={projectPageSize}
            onPage={setProjectPage}
            onPageSize={changeProjectPageSize}
          />
        </section>
      </CollapsibleSection>
      <CollapsibleSection
        storageKey={`workspace:${workspaceSlug}:systems`}
        title={t('systems')}
        defaultOpen
      >
        <section className="kh-ops-panel">
          <div className="kh-ops-toolbar mb-0 border-0 border-b border-line">
            <Input
              type="search"
              value={systemsTable.query}
              onChange={(event) => systemsTable.setQuery(event.target.value)}
              placeholder={t('sectionSearchSystems')}
              className="h-10 min-h-10 min-w-[220px] flex-1 py-1.5 text-xs"
            />
            <TableFilterControl
              fields={systemFields}
              enumFilters={systemsTable.filters}
              textFilters={systemsTable.textFilters}
              onEnumFilter={systemsTable.setEnumFilter}
              onTextFilter={systemsTable.setTextFilter}
              onClearFilters={systemsTable.clearFilters}
              filtersActive={systemsTable.filtersActive}
            />
            {systemsTable.filtersActive ? (
              <Button
                type="button"
                variant="secondary"
                className="kh-ops-tree-filter-clear h-8 min-h-8 px-2 text-xs"
                onClick={systemsTable.clearFilters}
              >
                {tTable('clearFilters')}
              </Button>
            ) : null}
            {canMutate ? (
              <LinkButton href={`/workspaces/${workspaceSlug}/systems/new`}>
                {t('newSystem')}
              </LinkButton>
            ) : null}
          </div>
          {filteredSystems.length === 0 ? (
            <p className="kh-ops-empty">
              {systemsTable.query.trim() || systemsTable.filtersActive
                ? t('sectionEmptyFiltered')
                : t('noSystems')}
            </p>
          ) : (
            <div className="kh-ops-table-wrap">
              <table className="kh-ops-data-table">
                <thead>
                  <tr>
                    <th>{t('colName')}</th>
                    <th>{t('colStatus')}</th>
                    <th>{t('colLink')}</th>
                    <th>{t('colUpdated')}</th>
                  </tr>
                </thead>
                <tbody>
                  {systemSlice.pageItems.map((system) => (
                    <tr key={system.id}>
                      <td className="kh-ops-primary-cell">
                        <Link
                          href={`/workspaces/${workspaceSlug}/systems/${system.slug}`}
                          className="no-underline"
                        >
                          {system.name}
                        </Link>
                      </td>
                      <td>
                        <span className="kh-ops-type-chip">{system.status}</span>
                      </td>
                      <td>
                        {system.projectId ? t('linkedToProject') : t('independent')}
                      </td>
                      <td>
                        <LocalDateTime value={system.updatedAt} dateOnly locale={locale} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <SectionPager
            title={t('systems')}
            total={filteredSystems.length}
            page={systemPage}
            pageSize={systemPageSize}
            onPage={setSystemPage}
            onPageSize={changeSystemPageSize}
          />
        </section>
      </CollapsibleSection>
      <CollapsibleSection
        storageKey={`workspace:${workspaceSlug}:records`}
        title={t('knowledgeRecords')}
        defaultOpen
      >
        <section className="kh-ops-panel">
          <div className="kh-ops-toolbar mb-0 border-0 border-b border-line">
            <Input
              type="search"
              value={recordsTable.query}
              onChange={(event) => recordsTable.setQuery(event.target.value)}
              placeholder={t('sectionSearchRecords')}
              className="h-10 min-h-10 min-w-[220px] flex-1 py-1.5 text-xs"
            />
            <TableFilterControl
              fields={recordFields}
              enumFilters={recordsTable.filters}
              textFilters={recordsTable.textFilters}
              onEnumFilter={recordsTable.setEnumFilter}
              onTextFilter={recordsTable.setTextFilter}
              onClearFilters={recordsTable.clearFilters}
              filtersActive={recordsTable.filtersActive}
            />
            {recordsTable.filtersActive ? (
              <Button
                type="button"
                variant="secondary"
                className="kh-ops-tree-filter-clear h-8 min-h-8 px-2 text-xs"
                onClick={recordsTable.clearFilters}
              >
                {tTable('clearFilters')}
              </Button>
            ) : null}
            {canMutate ? (
              <LinkButton href={`/workspaces/${workspaceSlug}/records/new`}>
                {t('newRecord')}
              </LinkButton>
            ) : null}
          </div>
          {filteredRecords.length === 0 ? (
            <p className="kh-ops-empty">
              {recordsTable.query.trim() || recordsTable.filtersActive
                ? t('sectionEmptyFiltered')
                : t('noRecords')}
            </p>
          ) : (
            <div className="kh-ops-table-wrap">
              <table className="kh-ops-data-table">
                <thead>
                  <tr>
                    <th>{t('colKey')}</th>
                    <th>{t('colTitle')}</th>
                    <th>{t('colType')}</th>
                    <th>{t('colLanguage')}</th>
                    <th>{t('colLifecycle')}</th>
                    <th>{t('colUpdated')}</th>
                  </tr>
                </thead>
                <tbody>
                  {recordSlice.pageItems.map(({ preferred, languages }) => {
                    const recordPath = recordHref({
                      workspaceSlug,
                      recordSlug: preferred.slug,
                    });
                    return (
                      <tr key={preferred.translationGroupId ?? preferred.id}>
                        <td>
                          <Link
                            href={recordPath}
                            className={
                              preferred.humanKey ? 'kh-ops-key-badge' : 'kh-ops-type-chip'
                            }
                          >
                            {preferred.humanKey ?? preferred.recordType}
                          </Link>
                        </td>
                        <td className="kh-ops-primary-cell">
                          <Link href={recordPath} className="no-underline">
                            {preferred.title}
                          </Link>
                        </td>
                        <td>{preferred.recordType}</td>
                        <td>{languages.join(', ')}</td>
                        <td>{lifecycleLabel(preferred.lifecycleStatus, tRecords)}</td>
                        <td>
                          <LocalDateTime value={preferred.updatedAt} dateOnly locale={locale} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <SectionPager
            title={t('knowledgeRecords')}
            total={filteredRecords.length}
            page={recordPage}
            pageSize={recordPageSize}
            onPage={setRecordPage}
            onPageSize={changeRecordPageSize}
          />
        </section>
      </CollapsibleSection>
      <CollapsibleSection
        storageKey={`workspace:${workspaceSlug}:imports`}
        title={t('imports')}
        defaultOpen
        action={
          canMutate ? (
            <ImportTypePickerButton workspaceSlug={workspaceSlug} label={t('newImport')} />
          ) : (
            <LinkButton href={`/workspaces/${workspaceSlug}/imports`} variant="secondary">
              {t('imports')}
            </LinkButton>
          )
        }
      >
        <p className="m-0 text-sm text-ink-muted">
          <Link href={`/workspaces/${workspaceSlug}/imports`} className="kh-text-link">
            {t('viewImports')}
          </Link>
        </p>
      </CollapsibleSection>
    </>
  );
}
