'use client';

import { type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import {
  columnKindClass,
  type ColumnKind,
  type FilterSpec,
  type SortDir,
  type SortSpec,
} from '../../lib/data-table';
import { cn } from '../../lib/cn';
import { Button } from './Button';
import { TableFilterControl, type TableFilterField } from './TableFilterControl';

export type DataColumn<T> = {
  id: string;
  header: string;
  kind: ColumnKind;
  sort?: SortSpec<T>;
  filter?: FilterSpec<T>;
  /** Title / name cell. Keeps the existing primary-cell weight. */
  primary?: boolean;
  cell: (row: T) => ReactNode;
};

function ariaSort<T>(
  column: { id: string; sort?: SortSpec<T> },
  sortKey: string | null,
  sortDir: SortDir,
): 'ascending' | 'descending' | 'none' | undefined {
  if (!column.sort) return undefined;
  if (sortKey !== column.id) return 'none';
  return sortDir === 'asc' ? 'ascending' : 'descending';
}

function filterField<T>(column: DataColumn<T>): TableFilterField | null {
  const filter = column.filter;
  if (!filter) return null;
  if (filter.type === 'text') {
    return { id: column.id, header: column.header, type: 'text' };
  }
  if ((filter.options?.length ?? 0) === 0) return null;
  return {
    id: column.id,
    header: column.header,
    type: 'enum',
    options: filter.options,
  };
}

export function DataTable<T>({
  rows,
  rowKey,
  columns,
  sortKey,
  sortDir,
  onToggleSort,
  enumFilters,
  textFilters,
  onEnumFilter,
  onTextFilter,
  onClearFilters,
  filtersActive,
  empty,
  tableClassName,
  footer,
}: {
  rows: T[];
  rowKey: (row: T) => string;
  columns: Array<DataColumn<T>>;
  sortKey: string | null;
  sortDir: SortDir;
  onToggleSort: (columnId: string, defaultDir?: SortDir) => void;
  enumFilters: Record<string, string[]>;
  textFilters: Record<string, string>;
  onEnumFilter: (columnId: string, values: string[]) => void;
  onTextFilter: (columnId: string, value: string) => void;
  onClearFilters: () => void;
  filtersActive: boolean;
  empty?: ReactNode;
  tableClassName?: string;
  footer?: ReactNode;
}) {
  const t = useTranslations('table');
  const filterFields = columns.flatMap((column) => {
    const field = filterField(column);
    return field ? [field] : [];
  });
  const embedFilters =
    filterFields.length > 0 && columns.some((column) => column.kind === 'actions');
  const filterControl = (
    <TableFilterControl
      fields={filterFields}
      enumFilters={enumFilters}
      textFilters={textFilters}
      onEnumFilter={onEnumFilter}
      onTextFilter={onTextFilter}
      onClearFilters={onClearFilters}
      filtersActive={filtersActive}
    />
  );

  return (
    <>
      <div className="kh-ops-table-wrap kh-ops-table-wrap--sticky">
        <table className={cn('kh-ops-data-table', 'kh-ops-data-table--fluid', tableClassName)}>
          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.id}
                  className={columnKindClass(column.kind)}
                  aria-sort={ariaSort(column, sortKey, sortDir)}
                >
                  {column.sort ? (
                    <button
                      type="button"
                      className="kh-ops-sort-btn"
                      data-sort-direction={
                        sortKey === column.id ? (sortDir === 'asc' ? '↑' : '↓') : undefined
                      }
                      aria-label={t('sortBy', { column: column.header })}
                      onClick={() => onToggleSort(column.id, column.sort?.defaultDir)}
                    >
                      {column.header}
                    </button>
                  ) : column.header ? (
                    column.header
                  ) : (
                    <span className="sr-only">{t('actions')}</span>
                  )}
                  {embedFilters && column.kind === 'actions' ? filterControl : null}
                </th>
              ))}
              {!embedFilters && filterFields.length > 0 ? (
                <th className="kh-ops-cell-actions">{filterControl}</th>
              ) : null}
            </tr>
          </thead>
          {rows.length > 0 ? (
            <tbody>
              {rows.map((row) => (
                <tr key={rowKey(row)}>
                  {columns.map((column) => (
                    <td
                      key={column.id}
                      className={cn(
                        columnKindClass(column.kind),
                        column.primary && 'kh-ops-primary-cell',
                      )}
                    >
                      {column.cell(row)}
                    </td>
                  ))}
                  {!embedFilters && filterFields.length > 0 ? (
                    <td className="kh-ops-cell-actions" />
                  ) : null}
                </tr>
              ))}
            </tbody>
          ) : null}
        </table>
      </div>
      {rows.length === 0 && empty ? (
        <div className="kh-ops-empty-state">
          <div className="kh-ops-empty-mark">00</div>
          {empty}
          {filtersActive ? (
            <Button type="button" variant="secondary" onClick={onClearFilters}>
              {t('clearFilters')}
            </Button>
          ) : null}
        </div>
      ) : null}
      {footer}
    </>
  );
}
