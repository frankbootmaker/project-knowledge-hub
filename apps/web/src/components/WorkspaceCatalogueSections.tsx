'use client';

import { useId, useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { cn } from '../lib/cn';
import {
  Badge,
  Button,
  FunctionHeader,
  Input,
  LinkButton,
  ListCard,
  SectionHeader,
  Select,
} from './ui';
import { ImportTypePickerButton } from './ImportTypePickerButton';

const DEFAULT_PAGE_SIZE = 5;
const PAGE_SIZE_OPTIONS = [5, 10, 25, 50] as const;

function FilterToggleIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className="size-4 shrink-0"
      fill="none"
    >
      <path
        d="M4 6h16M7 12h10M10 18h4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export type CatalogueListItem = {
  id: string;
  title: string;
  href: string;
  primaryBadge?: string;
  secondaryBadge?: string;
  subtitle?: string | null;
  tagsLine?: string | null;
  /** Lowercased haystack for search. */
  searchText: string;
  /** Value matched by the filter select (e.g. status / lifecycle). */
  filterValue: string;
};

function CatalogueSection({
  title,
  items,
  emptyLabel,
  searchPlaceholder,
  filterLabel,
  filterAllLabel,
  createHref,
  createLabel,
  canCreate,
}: {
  title: string;
  items: CatalogueListItem[];
  emptyLabel: string;
  searchPlaceholder: string;
  filterLabel: string;
  filterAllLabel: string;
  createHref: string;
  createLabel: string;
  canCreate: boolean;
}) {
  const t = useTranslations('workspaces');
  const controlsId = useId();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterValue, setFilterValue] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);

  const filterOptions = useMemo(() => {
    const values = [...new Set(items.map((item) => item.filterValue).filter(Boolean))];
    values.sort((a, b) => a.localeCompare(b));
    return values;
  }, [items]);

  const filtered = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return items.filter((item) => {
      if (filterValue !== 'all' && item.filterValue !== filterValue) {
        return false;
      }
      if (!query) {
        return true;
      }
      return item.searchText.includes(query);
    });
  }, [items, searchQuery, filterValue]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * pageSize;
  const pageItems = filtered.slice(pageStart, pageStart + pageSize);
  const rangeFrom = filtered.length === 0 ? 0 : pageStart + 1;
  const rangeTo = Math.min(pageStart + pageSize, filtered.length);
  const filtersActive =
    searchQuery.trim() !== '' ||
    filterValue !== 'all' ||
    pageSize !== DEFAULT_PAGE_SIZE;

  function updateSearch(value: string) {
    setSearchQuery(value);
    setPage(1);
  }

  function updateFilter(value: string) {
    setFilterValue(value);
    setPage(1);
  }

  function updatePageSize(value: number) {
    setPageSize(value);
    setPage(1);
  }

  return (
    <section className="mb-8">
      <SectionHeader title={title} />
      <FunctionHeader
        className="mb-3"
        search={
          filtersOpen ? (
            <Input
              id={`${controlsId}-search`}
              type="search"
              value={searchQuery}
              onChange={(e) => updateSearch(e.target.value)}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
            />
          ) : undefined
        }
        filters={
          filtersOpen ? (
            <div id={controlsId} className="contents">
              <Select
                value={filterValue}
                onChange={(e) => updateFilter(e.target.value)}
                aria-label={filterLabel}
              >
                <option value="all">{filterAllLabel}</option>
                {filterOptions.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </Select>
              <Select
                value={String(pageSize)}
                onChange={(e) => updatePageSize(Number(e.target.value))}
                aria-label={t('sectionPageSize')}
              >
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <option key={size} value={size}>
                    {t('sectionPageSizeOption', { count: size })}
                  </option>
                ))}
              </Select>
            </div>
          ) : undefined
        }
        actions={
          <>
            <Button
              type="button"
              variant="secondary"
              className={cn(
                'relative size-[2.0475rem] shrink-0 px-0 py-0',
                filtersOpen && 'ring-2 ring-brand/35',
              )}
              aria-expanded={filtersOpen}
              aria-controls={filtersOpen ? controlsId : undefined}
              aria-label={
                filtersOpen ? t('sectionHideFilters') : t('sectionShowFilters')
              }
              onClick={() => setFiltersOpen((open) => !open)}
            >
              <FilterToggleIcon />
              {filtersActive ? (
                <span
                  className="absolute top-1 right-1 size-1.5 rounded-full bg-brand"
                  aria-hidden
                />
              ) : null}
            </Button>
            {canCreate ? (
              <LinkButton href={createHref}>{createLabel}</LinkButton>
            ) : null}
          </>
        }
      />

      <ul className="m-0 grid list-none gap-3 p-0">
        {pageItems.map((item) => (
          <ListCard key={item.id}>
            <div className="flex flex-wrap items-center gap-2">
              <Link href={item.href} className="font-semibold no-underline">
                {item.title}
              </Link>
              {item.primaryBadge ? (
                <Badge tone="brand">{item.primaryBadge}</Badge>
              ) : null}
              {item.secondaryBadge ? <Badge>{item.secondaryBadge}</Badge> : null}
            </div>
            {item.subtitle ? (
              <p className="mt-2 mb-0 text-sm text-ink-muted">{item.subtitle}</p>
            ) : null}
            {item.tagsLine ? (
              <p className="mt-2 mb-0 text-xs text-ink-muted">{item.tagsLine}</p>
            ) : null}
          </ListCard>
        ))}
        {filtered.length === 0 ? (
          <li className="kh-muted list-none">
            {items.length === 0 ? emptyLabel : t('sectionEmptyFiltered')}
          </li>
        ) : null}
      </ul>

      {filtered.length > 0 ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="m-0 text-sm text-ink-muted">
            {t('sectionShowing', {
              from: rangeFrom,
              to: rangeTo,
              total: filtered.length,
            })}
          </p>
          {totalPages > 1 ? (
            <nav
              className="flex flex-wrap items-center gap-2"
              aria-label={title}
            >
              <Button
                type="button"
                variant="secondary"
                disabled={currentPage <= 1}
                onClick={() => setPage((prev) => Math.max(1, prev - 1))}
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
                onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
              >
                {t('sectionNextPage')}
              </Button>
            </nav>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export type WorkspaceCatalogueProject = {
  id: string;
  name: string;
  slug: string;
  status: string;
  summary: string | null;
  tags: Array<{ name: string }>;
};

export type WorkspaceCatalogueSystem = {
  id: string;
  name: string;
  slug: string;
  status: string;
  projectId: string | null;
  summary: string | null;
  tags: Array<{ name: string }>;
};

export type WorkspaceCatalogueRecord = {
  id: string;
  title: string;
  slug: string;
  recordType: string;
  lifecycleStatus: string;
  summary: string | null;
  systemId: string | null;
};

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
  const tCommon = useTranslations('common');

  const projectItems: CatalogueListItem[] = projects.map((project) => ({
    id: project.id,
    title: project.name,
    href: `/workspaces/${workspaceSlug}/projects/${project.slug}`,
    primaryBadge: project.status,
    subtitle: project.summary,
    tagsLine:
      project.tags.length > 0
        ? tCommon('tagsList', {
            tags: project.tags.map((tag) => tag.name).join(', '),
          })
        : null,
    searchText: [project.name, project.slug, project.summary ?? '', project.status]
      .join(' ')
      .toLowerCase(),
    filterValue: project.status,
  }));

  const systemItems: CatalogueListItem[] = systems.map((system) => ({
    id: system.id,
    title: system.name,
    href: `/workspaces/${workspaceSlug}/systems/${system.slug}`,
    secondaryBadge: system.status,
    subtitle: `${system.projectId ? t('linkedToProject') : t('independent')}${
      system.summary ? ` — ${system.summary}` : ''
    }`,
    tagsLine:
      system.tags.length > 0
        ? tCommon('tagsList', {
            tags: system.tags.map((tag) => tag.name).join(', '),
          })
        : null,
    searchText: [system.name, system.slug, system.summary ?? '', system.status]
      .join(' ')
      .toLowerCase(),
    filterValue: system.status,
  }));

  const recordItems: CatalogueListItem[] = records.map((record) => ({
    id: record.id,
    title: record.title,
    href: `/workspaces/${workspaceSlug}/records/${record.slug}`,
    primaryBadge: record.recordType,
    secondaryBadge: record.lifecycleStatus,
    subtitle: record.systemId
      ? `${t('linkedToSystem')}${record.summary ? ` — ${record.summary}` : ''}`
      : record.summary,
    searchText: [
      record.title,
      record.slug,
      record.recordType,
      record.lifecycleStatus,
      record.summary ?? '',
    ]
      .join(' ')
      .toLowerCase(),
    filterValue: record.lifecycleStatus,
  }));

  return (
    <>
      <CatalogueSection
        title={t('projects')}
        items={projectItems}
        emptyLabel={t('noProjects')}
        searchPlaceholder={t('sectionSearchProjects')}
        filterLabel={t('sectionFilterStatus')}
        filterAllLabel={t('sectionFilterAll')}
        createHref={`/workspaces/${workspaceSlug}/projects/new`}
        createLabel={t('newProject')}
        canCreate={canMutate}
      />
      <CatalogueSection
        title={t('systems')}
        items={systemItems}
        emptyLabel={t('noSystems')}
        searchPlaceholder={t('sectionSearchSystems')}
        filterLabel={t('sectionFilterStatus')}
        filterAllLabel={t('sectionFilterAll')}
        createHref={`/workspaces/${workspaceSlug}/systems/new`}
        createLabel={t('newSystem')}
        canCreate={canMutate}
      />
      <CatalogueSection
        title={t('knowledgeRecords')}
        items={recordItems}
        emptyLabel={t('noRecords')}
        searchPlaceholder={t('sectionSearchRecords')}
        filterLabel={t('sectionFilterLifecycle')}
        filterAllLabel={t('sectionFilterAll')}
        createHref={`/workspaces/${workspaceSlug}/records/new`}
        createLabel={t('newRecord')}
        canCreate={canMutate}
      />
      <section>
        <SectionHeader
          title={t('imports')}
          action={
            canMutate ? (
              <ImportTypePickerButton
                workspaceSlug={workspaceSlug}
                label={t('newImport')}
              />
            ) : (
              <LinkButton
                href={`/workspaces/${workspaceSlug}/imports`}
                variant="secondary"
              >
                {t('imports')}
              </LinkButton>
            )
          }
        />
      </section>
    </>
  );
}
