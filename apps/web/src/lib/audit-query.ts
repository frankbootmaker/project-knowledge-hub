export type AuditQuery = {
  q: string;
  action: string;
  entityType: string;
  actorType: string;
  day: string;
  from: string;
  to: string;
  month: string;
  page: number;
  pageSize: number;
};

export function parseAuditQuery(
  params: Record<string, string | string[] | undefined>,
): AuditQuery {
  const single = (key: string) => {
    const value = params[key];
    return typeof value === 'string' ? value : '';
  };

  const pageRaw = Number(single('page') || '1');
  const pageSizeRaw = Number(single('pageSize') || '5');

  return {
    q: single('q'),
    action: single('action'),
    entityType: single('entityType'),
    actorType: single('actorType'),
    day: single('day'),
    from: single('from'),
    to: single('to'),
    month: single('month') || new Date().toISOString().slice(0, 7),
    page: Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1,
    pageSize:
      Number.isFinite(pageSizeRaw) && pageSizeRaw > 0
        ? Math.min(100, Math.floor(pageSizeRaw))
        : 5,
  };
}

export function buildAuditFilterParams(
  query: Partial<AuditQuery>,
  overrides: Partial<AuditQuery> = {},
): URLSearchParams {
  const merged = { ...query, ...overrides };
  const params = new URLSearchParams();

  if (merged.q) params.set('q', merged.q);
  if (merged.action) params.set('action', merged.action);
  if (merged.entityType) params.set('entityType', merged.entityType);
  if (merged.actorType) params.set('actorType', merged.actorType);
  if (merged.day) params.set('day', merged.day);
  if (merged.from) params.set('from', merged.from);
  if (merged.to) params.set('to', merged.to);

  return params;
}

export function buildAuditSearchParams(
  query: Partial<AuditQuery>,
  overrides: Partial<AuditQuery> = {},
): URLSearchParams {
  const merged = { ...query, ...overrides };
  const params = buildAuditFilterParams(merged);

  if (merged.month) params.set('month', merged.month);
  if (merged.page && merged.page > 1) params.set('page', String(merged.page));
  if (merged.pageSize && merged.pageSize !== 5) {
    params.set('pageSize', String(merged.pageSize));
  }

  return params;
}

export function buildAuditExportHref(
  query: Partial<AuditQuery>,
  format: 'csv' | 'json',
): string {
  const params = buildAuditFilterParams(query);
  params.set('format', format);
  return `/api/v1/audit-events/export?${params.toString()}`;
}

export function shiftMonth(month: string, delta: number): string {
  const [year, monthNumber] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year!, (monthNumber ?? 1) - 1 + delta, 1));
  const nextYear = date.getUTCFullYear();
  const nextMonth = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${nextYear}-${nextMonth}`;
}

export function daysInMonth(month: string): number {
  const [year, monthNumber] = month.split('-').map(Number);
  return new Date(Date.UTC(year!, monthNumber!, 0)).getUTCDate();
}

export function monthStartWeekday(month: string): number {
  const [year, monthNumber] = month.split('-').map(Number);
  // 0 = Sunday … 6 = Saturday
  return new Date(Date.UTC(year!, (monthNumber ?? 1) - 1, 1)).getUTCDay();
}

/** Compact page list with ellipsis for large totals, e.g. 1 … 4 5 6 … 20 */
export function visiblePageNumbers(
  current: number,
  total: number,
): Array<number | 'ellipsis'> {
  if (total <= 1) return total === 1 ? [1] : [];
  if (total <= 7) {
    return Array.from({ length: total }, (_, index) => index + 1);
  }

  const pages = new Set<number>([1, total, current, current - 1, current + 1]);
  if (current <= 3) {
    pages.add(2);
    pages.add(3);
    pages.add(4);
  }
  if (current >= total - 2) {
    pages.add(total - 3);
    pages.add(total - 2);
    pages.add(total - 1);
  }

  const sorted = [...pages]
    .filter((page) => page >= 1 && page <= total)
    .sort((a, b) => a - b);

  const result: Array<number | 'ellipsis'> = [];
  for (let index = 0; index < sorted.length; index += 1) {
    const page = sorted[index]!;
    const previous = sorted[index - 1];
    if (previous != null && page - previous > 1) {
      result.push('ellipsis');
    }
    result.push(page);
  }
  return result;
}
