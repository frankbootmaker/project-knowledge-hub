'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Button, Select } from './ui';
import type { DashboardRecentItem } from '../lib/dashboard';

const DEFAULT_PAGE_SIZE = 5;
const PAGE_SIZE_OPTIONS = [5, 10, 25, 50] as const;
type PageSizeOption = (typeof PAGE_SIZE_OPTIONS)[number];

function isPageSizeOption(value: number): value is PageSizeOption {
  return (PAGE_SIZE_OPTIONS as readonly number[]).includes(value);
}

export function DashboardRecentList({
  items,
}: {
  items: DashboardRecentItem[];
}) {
  const t = useTranslations('dashboard');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSizeOption>(DEFAULT_PAGE_SIZE);

  function updatePageSize(raw: string) {
    const parsed = Number(raw);
    setPageSize(isPageSizeOption(parsed) ? parsed : DEFAULT_PAGE_SIZE);
    setPage(1);
  }

  function kindLabel(kind: DashboardRecentItem['kind']): string {
    if (kind === 'project') return t('kindProject');
    if (kind === 'system') return t('kindSystem');
    return t('kindRecord');
  }

  const totalPages = Math.max(1, Math.ceil(items.length / pageSize) || 1);
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const pageStart = (currentPage - 1) * pageSize;
  const pageItems = useMemo(
    () => items.slice(pageStart, pageStart + pageSize),
    [items, pageStart, pageSize],
  );
  const rangeFrom = items.length === 0 ? 0 : pageStart + 1;
  const rangeTo = Math.min(pageStart + pageSize, items.length);

  return (
    <section className="kh-ops-panel">
      <div className="kh-ops-panel-head">
        <h2 className="kh-ops-panel-title">{t('recentTitle')}</h2>
      </div>
      {items.length === 0 ? (
        <p className="kh-ops-empty">{t('recentEmpty')}</p>
      ) : (
        <>
          <div className="kh-ops-toolbar mb-0 border-0 border-b border-line justify-end">
            <Select
              value={String(pageSize)}
              onChange={(event) => updatePageSize(event.target.value)}
              aria-label={t('pageSize')}
              className="h-10 min-h-10 w-auto min-w-[9rem] py-1.5 text-xs"
            >
              {PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={String(size)}>
                  {t('pageSizeOption', { count: size })}
                </option>
              ))}
            </Select>
          </div>
          <div className="kh-ops-table-wrap">
            <table className="kh-ops-data-table">
              <thead>
                <tr>
                  <th>{t('colWorkItem')}</th>
                  <th>{t('colKind')}</th>
                  <th>{t('colWorkspace')}</th>
                  <th>{t('colUpdated')}</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((item) => (
                  <tr key={`${item.kind}-${item.id}`}>
                    <td className="kh-ops-primary-cell">
                      <Link href={item.href} className="no-underline">
                        {item.title}
                      </Link>
                    </td>
                    <td>
                      <span className="kh-ops-type-chip">{kindLabel(item.kind)}</span>
                    </td>
                    <td>{item.workspaceName}</td>
                    <td>
                      <time dateTime={item.updatedAt}>
                        {new Date(item.updatedAt).toLocaleString()}
                      </time>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="kh-ops-card-foot">
            <p className="m-0 text-xs text-ink-muted">
              {t('showing', {
                from: rangeFrom,
                to: rangeTo,
                total: items.length,
              })}
            </p>
            {totalPages > 1 ? (
              <nav
                className="flex flex-wrap items-center gap-2"
                aria-label={t('recentTitle')}
              >
                <Button
                  type="button"
                  variant="secondary"
                  disabled={currentPage <= 1}
                  onClick={() => setPage(Math.max(1, currentPage - 1))}
                >
                  {t('prevPage')}
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
                  {t('nextPage')}
                </Button>
              </nav>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}
