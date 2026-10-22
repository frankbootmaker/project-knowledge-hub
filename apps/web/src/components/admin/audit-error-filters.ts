import type { MonitoringAuditError, MonitoringAuditErrorType } from './monitoring-types';

export const AUDIT_ERROR_TYPE_FILTERS = [
  'all',
  'validation',
  'not_found',
  'forbidden',
  'internal',
] as const;

export type AuditErrorTypeFilter = (typeof AUDIT_ERROR_TYPE_FILTERS)[number];

export type AuditErrorClientOption = {
  key: string;
  label: string;
};

/** Stable key so the same API client or OAuth grant stays one filter row. */
export function auditErrorClientKey(row: MonitoringAuditError): string {
  if (row.client.id) return `id:${row.client.id}`;
  if (row.clientInfo?.name) return `info:${row.clientInfo.name}`;
  return 'unknown';
}

export function auditErrorClientLabel(row: MonitoringAuditError): string {
  const name = row.client.name || row.clientInfo?.name || '';
  if (!name) return 'unknown';
  const info = row.clientInfo?.name && row.clientInfo.name !== name
    ? ` · ${row.clientInfo.name}`
    : '';
  return `${name}${info}`;
}

export function auditErrorClientOptions(rows: MonitoringAuditError[]): AuditErrorClientOption[] {
  const byKey = new Map<string, string>();
  for (const row of rows) {
    const key = auditErrorClientKey(row);
    if (!byKey.has(key)) byKey.set(key, auditErrorClientLabel(row));
  }
  return [...byKey.entries()]
    .map(([key, label]) => ({ key, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function filterAuditErrors(
  rows: MonitoringAuditError[],
  filters: { errorType: AuditErrorTypeFilter; clientKey: string },
): MonitoringAuditError[] {
  return rows.filter((row) => {
    if (filters.errorType !== 'all' && row.errorType !== filters.errorType) return false;
    if (filters.clientKey !== 'all' && auditErrorClientKey(row) !== filters.clientKey) return false;
    return true;
  });
}

export function auditErrorTypeTone(
  errorType: MonitoringAuditErrorType | null,
): 'neutral' | 'warn' | 'danger' {
  if (errorType === 'internal') return 'danger';
  if (errorType === 'forbidden' || errorType === 'not_found') return 'warn';
  return 'neutral';
}
