'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Badge, Button, Input } from './ui';
import type { ChangeItem } from './ProjectChangePanel';

type SortKey = 'id' | 'kind' | 'title' | 'status' | 'requested' | 'effective';

function compareText(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: 'base' });
}

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
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('id');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((current) => (current === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    setSortDir(key === 'effective' || key === 'id' ? 'desc' : 'asc');
  }

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matched = needle
      ? items.filter((item) =>
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
        )
      : items;
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...matched].sort((a, b) => {
      let result = 0;
      switch (sortKey) {
        case 'kind':
          result = compareText(a.kind, b.kind);
          break;
        case 'title':
          result = compareText(a.title, b.title);
          break;
        case 'status':
          result = compareText(a.status, b.status);
          break;
        case 'requested':
          result = compareText(
            a.requestedBy?.displayName ?? '',
            b.requestedBy?.displayName ?? '',
          );
          break;
        case 'effective':
          result = compareText(a.effectiveDate ?? '', b.effectiveDate ?? '');
          break;
        default:
          result = compareText(a.humanKey ?? a.title, b.humanKey ?? b.title);
      }
      if (result === 0) result = compareText(a.title, b.title);
      return result * dir;
    });
  }, [items, query, sortDir, sortKey]);

  const columns: Array<{ key: SortKey; label: string }> = [
    { key: 'id', label: t('colId') },
    { key: 'kind', label: t('colKind') },
    { key: 'title', label: t('colTitle') },
    { key: 'status', label: t('colStatus') },
    { key: 'requested', label: t('colRequestedBy') },
    { key: 'effective', label: t('colEffective') },
  ];

  return (
    <section className="kh-ops-panel">
      <div className="kh-ops-toolbar mb-0 border-0 border-b border-line">
        <label className="flex min-w-[220px] flex-1 items-center gap-2">
          <span className="sr-only">{t('searchPlaceholder')}</span>
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
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
      {filtered.length === 0 ? (
        <div className="kh-ops-empty-state">
          <div className="kh-ops-empty-mark">00</div>
          <h3>{t('emptyTitle')}</h3>
          <p>{query.trim() ? t('emptyFiltered') : t('empty')}</p>
        </div>
      ) : (
        <div className="kh-ops-table-wrap">
          <table className="kh-ops-data-table kh-ops-delivery-list">
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={column.key}>
                    <button
                      type="button"
                      data-sort-direction={
                        sortKey === column.key
                          ? (sortDir === 'asc' ? '↑' : '↓')
                          : undefined
                      }
                      aria-label={t('sortBy', { column: column.label })}
                      onClick={() => toggleSort(column.key)}
                    >
                      {column.label}
                    </button>
                  </th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => (
                <tr key={item.id}>
                  <td>
                    <span className="kh-ops-type-chip">
                      {item.humanKey ?? t(`kind.${item.kind}`)}
                    </span>
                  </td>
                  <td>
                    <span className="kh-ops-type-chip">{t(`kind.${item.kind}`)}</span>
                  </td>
                  <td className="kh-ops-primary-cell">
                    <button
                      type="button"
                      className="border-0 bg-transparent p-0 text-left text-inherit"
                      onClick={() => onManage(item.id)}
                    >
                      {item.title}
                    </button>
                  </td>
                  <td>
                    <Badge>{t(`status.${item.status}`)}</Badge>
                  </td>
                  <td>{item.requestedBy?.displayName ?? t('unassigned')}</td>
                  <td>{item.effectiveDate ?? '—'}</td>
                  <td>
                    <Button
                      type="button"
                      variant="secondary"
                      className="h-8 min-h-8 px-2 text-xs"
                      onClick={() => onManage(item.id)}
                    >
                      {t('manage')}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
