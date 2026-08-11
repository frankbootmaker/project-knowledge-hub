'use client';

import { useId, useMemo, useState, type ReactNode } from 'react';
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
import { LocalDateTime } from './LocalDateTime';

const DEFAULT_PAGE_SIZE = 5;
/** Include a size below typical short lists so page-size changes are visible. */
const PAGE_SIZE_OPTIONS = [3, 5, 10, 25] as const;
type PageSizeOption = (typeof PAGE_SIZE_OPTIONS)[number];
type SortOption = 'az' | 'za' | 'oldest' | 'latest';
const DEFAULT_SORT: SortOption = 'latest';

function isPageSizeOption(value: number): value is PageSizeOption {
  return (PAGE_SIZE_OPTIONS as readonly number[]).includes(value);
}

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

export type CatalogueLocaleVariant = {
  id: string;
  title: string;
  href: string;
  language: string;
  secondaryBadge?: string;
  subtitle?: string | null;
  updatedAt?: string | null;
  filterValue: string;
  filterLabel?: string;
};

export type CatalogueBadgeTone =
  | 'neutral'
  | 'brand'
  | 'success'
  | 'warn'
  | 'danger';

export type CatalogueListItem = {
  id: string;
  title: string;
  /** When omitted, the title is plain text (no detail link). */
  href?: string;
  primaryBadge?: string;
  secondaryBadge?: string;
  /** Status chips shown immediately after the title (e.g. overall RAG). */
  statusBadges?: Array<{
    label: string;
    tone?: CatalogueBadgeTone;
    title?: string;
  }>;
  subtitle?: string | null;
  tagsLine?: string | null;
  /** ISO timestamp shown like dashboard “recently updated”. */
  updatedAt?: string | null;
  /** Lowercased haystack for search. */
  searchText: string;
  /** Value matched by the filter select (e.g. status / lifecycle). */
  filterValue: string;
  /** Optional display label for filterValue in the select (defaults to filterValue). */
  filterLabel?: string;
  /** Optional content language code for a secondary language filter. */
  language?: string | null;
  /** All content languages in this translation family (for badge + filter options). */
  languages?: string[];
  /** Locale siblings; language filter swaps the visible title/href among these. */
  localeVariants?: CatalogueLocaleVariant[];
};

function resolveCatalogueItem(
  item: CatalogueListItem,
  languageFilter: string,
): CatalogueListItem | null {
  const variants = item.localeVariants;
  if (!variants || variants.length === 0) {
    if (
      languageFilter !== 'all' &&
      (item.language ?? 'en') !== languageFilter
    ) {
      return null;
    }
    return item;
  }

  if (languageFilter === 'all') {
    return item;
  }

  const match = variants.find((variant) => variant.language === languageFilter);
  if (!match) {
    return null;
  }

  return {
    ...item,
    id: item.id,
    title: match.title,
    href: match.href,
    language: match.language,
    secondaryBadge: match.secondaryBadge,
    subtitle: match.subtitle,
    updatedAt: match.updatedAt,
    filterValue: match.filterValue,
    filterLabel: match.filterLabel,
  };
}

export function CatalogueSection({
  title,
  items,
  emptyLabel,
  searchPlaceholder,
  filterLabel,
  filterAllLabel,
  languageFilterLabel,
  languageFilterAllLabel,
  createHref,
  onCreate,
  createLabel,
  canCreate,
  renderItem,
  extraActions,
  showTitle = true,
  showList = true,
  defaultSort = DEFAULT_SORT,
  className,
}: {
  title: string;
  items: CatalogueListItem[];
  emptyLabel: string;
  searchPlaceholder: string;
  filterLabel: string;
  filterAllLabel: string;
  languageFilterLabel?: string;
  languageFilterAllLabel?: string;
  /** Detail/create page link. Prefer `onCreate` for modal flows. */
  createHref?: string;
  /** Opens a create flow (e.g. modal) instead of navigating. */
  onCreate?: () => void;
  createLabel: string;
  canCreate: boolean;
  /** Replace the default list-card body for each item. */
  renderItem?: (item: CatalogueListItem) => ReactNode;
  /** Extra controls in the toolbar actions (before Create). */
  extraActions?: ReactNode;
  /** When false, omit the section heading (parent already rendered one). */
  showTitle?: boolean;
  /** When false, render only the toolbar (e.g. board/calendar body below). */
  showList?: boolean;
  /** Initial sort (also treated as the “filters inactive” baseline). */
  defaultSort?: SortOption;
  className?: string;
}) {
  const t = useTranslations('workspaces');
  const tCommon = useTranslations('common');
  const controlsId = useId();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterValue, setFilterValue] = useState('all');
  const [languageFilter, setLanguageFilter] = useState('all');
  const [sortOrder, setSortOrder] = useState<SortOption>(defaultSort);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSizeOption>(DEFAULT_PAGE_SIZE);

  const showLanguageFilter = Boolean(languageFilterLabel && languageFilterAllLabel);

  const filterOptions = useMemo(() => {
    const labels = new Map<string, string>();
    for (const item of items) {
      if (!item.filterValue || labels.has(item.filterValue)) continue;
      labels.set(item.filterValue, item.filterLabel ?? item.filterValue);
    }
    return [...labels.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [items]);

  const languageOptions = useMemo(() => {
    if (!showLanguageFilter) return [];
    const values = new Set<string>();
    for (const item of items) {
      for (const code of item.languages ?? []) {
        if (code.trim()) values.add(code);
      }
      const fallback = item.language?.trim();
      if (fallback) values.add(fallback);
    }
    return [...values].sort((a, b) => a.localeCompare(b));
  }, [items, showLanguageFilter]);

  const filtered = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const matched: CatalogueListItem[] = [];
    for (const item of items) {
      const resolved =
        showLanguageFilter
          ? resolveCatalogueItem(item, languageFilter)
          : resolveCatalogueItem(item, 'all');
      if (!resolved) continue;
      if (filterValue !== 'all' && resolved.filterValue !== filterValue) {
        continue;
      }
      if (query && !resolved.searchText.includes(query)) {
        continue;
      }
      matched.push(resolved);
    }

    const sorted = [...matched];
    sorted.sort((a, b) => {
      if (sortOrder === 'az' || sortOrder === 'za') {
        const cmp = a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
        return sortOrder === 'az' ? cmp : -cmp;
      }
      const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      return sortOrder === 'oldest' ? aTime - bTime : bTime - aTime;
    });
    return sorted;
  }, [
    items,
    searchQuery,
    filterValue,
    languageFilter,
    showLanguageFilter,
    sortOrder,
  ]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize) || 1);
  // Clamp for display/actions — no syncing effect (avoids remount/HMR races).
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const pageStart = (currentPage - 1) * pageSize;
  const pageItems = filtered.slice(pageStart, pageStart + pageSize);
  const rangeFrom = filtered.length === 0 ? 0 : pageStart + 1;
  const rangeTo = Math.min(pageStart + pageSize, filtered.length);
  const filtersActive =
    searchQuery.trim() !== '' ||
    filterValue !== 'all' ||
    languageFilter !== 'all' ||
    sortOrder !== defaultSort ||
    pageSize !== DEFAULT_PAGE_SIZE;

  function updateSearch(value: string) {
    setSearchQuery(value);
    setPage(1);
  }

  function updateFilter(value: string) {
    setFilterValue(value);
    setPage(1);
  }

  function updateLanguageFilter(value: string) {
    setLanguageFilter(value);
    setPage(1);
  }

  function updateSort(value: SortOption) {
    setSortOrder(value);
    setPage(1);
  }

  function updatePageSize(raw: string) {
    const parsed = Number(raw);
    setPageSize(isPageSizeOption(parsed) ? parsed : DEFAULT_PAGE_SIZE);
    setPage(1);
  }

  return (
    <section className={cn('mb-8', className)}>
      {showTitle ? <SectionHeader title={title} /> : null}
      <FunctionHeader
        className="mb-3"
        search={
          showList && filtersOpen ? (
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
          showList && filtersOpen ? (
            <div
              id={controlsId}
              className="flex shrink-0 flex-nowrap items-center gap-2"
            >
              <Select
                value={filterValue}
                onChange={(e) => updateFilter(e.target.value)}
                aria-label={filterLabel}
              >
                <option value="all">{filterAllLabel}</option>
                {filterOptions.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
              {showLanguageFilter ? (
                <Select
                  value={languageFilter}
                  onChange={(e) => updateLanguageFilter(e.target.value)}
                  aria-label={languageFilterLabel}
                >
                  <option value="all">{languageFilterAllLabel}</option>
                  {languageOptions.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </Select>
              ) : null}
              <Select
                value={sortOrder}
                onChange={(e) => updateSort(e.target.value as SortOption)}
                aria-label={t('sectionSort')}
              >
                <option value="az">{t('sectionSortAz')}</option>
                <option value="za">{t('sectionSortZa')}</option>
                <option value="oldest">{t('sectionSortOldest')}</option>
                <option value="latest">{t('sectionSortLatest')}</option>
              </Select>
              <Select
                value={String(pageSize)}
                onChange={(e) => updatePageSize(e.target.value)}
                aria-label={t('sectionPageSize')}
              >
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <option key={size} value={String(size)}>
                    {t('sectionPageSizeOption', { count: size })}
                  </option>
                ))}
              </Select>
            </div>
          ) : undefined
        }
        actions={
          <>
            {extraActions}
            {showList ? (
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
            ) : null}
            {canCreate ? (
              onCreate ? (
                <Button type="button" onClick={onCreate}>
                  {createLabel}
                </Button>
              ) : createHref ? (
                <LinkButton href={createHref}>{createLabel}</LinkButton>
              ) : null
            ) : null}
          </>
        }
      />

      {showList ? (
        <>
          <ul className="m-0 grid list-none gap-3 p-0">
            {pageItems.map((item) => (
              <ListCard key={item.id}>
                {renderItem ? (
                  renderItem(item)
                ) : (
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        {item.primaryBadge ? (
                          <Badge tone="brand">{item.primaryBadge}</Badge>
                        ) : null}
                        {item.href ? (
                          <Link href={item.href} className="font-semibold no-underline">
                            {item.title}
                          </Link>
                        ) : (
                          <span className="font-semibold">{item.title}</span>
                        )}
                        {item.statusBadges?.map((badge) => (
                          <Badge
                            key={`${item.id}-${badge.label}`}
                            tone={badge.tone ?? 'neutral'}
                            title={badge.title}
                          >
                            {badge.label}
                          </Badge>
                        ))}
                        {item.secondaryBadge ? <Badge>{item.secondaryBadge}</Badge> : null}
                        {(item.languages?.length ?? 0) > 1 ? (
                          <span
                            className="text-xs font-medium tracking-wide text-ink-muted uppercase"
                            title={t('sectionLanguages')}
                          >
                            {item.languages!.map((code) => code.toUpperCase()).join(' · ')}
                          </span>
                        ) : null}
                      </div>
                      {item.subtitle ? (
                        <p className="mt-2 mb-0 text-sm text-ink-muted">{item.subtitle}</p>
                      ) : null}
                      {item.tagsLine ? (
                        <p className="mt-2 mb-0 text-xs text-ink-muted">{item.tagsLine}</p>
                      ) : null}
                    </div>
                    {item.updatedAt ? (
                      <LocalDateTime
                        className="shrink-0 text-xs text-ink-muted"
                        value={item.updatedAt}
                        prefix={tCommon('lastUpdated')}
                      />
                    ) : null}
                  </div>
                )}
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
                    onClick={() => setPage(Math.max(1, currentPage - 1))}
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
                    onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
                  >
                    {t('sectionNextPage')}
                  </Button>
                </nav>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
