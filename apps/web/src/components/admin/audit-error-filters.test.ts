import { describe, expect, it } from 'vitest';
import {
  auditErrorClientKey,
  filterAuditErrors,
} from './audit-error-filters';
import type { MonitoringAuditError } from './monitoring-types';

function row(
  id: string,
  errorType: MonitoringAuditError['errorType'],
  clientId: string | null,
  clientName: string | null,
): MonitoringAuditError {
  return {
    id,
    action: 'mcp.tool_error',
    entityType: 'mcp_tool',
    entityId: 'get_project',
    createdAt: '2026-10-22T00:00:00.000Z',
    errorType,
    message: 'safe',
    client: { id: clientId, name: clientName, kind: 'api_client', oauthClientId: null },
    clientInfo: clientName ? { name: clientName, version: '1' } : null,
    user: { id: 'user-1', name: 'Ada' },
  };
}

const rows = [
  row('1', 'validation', 'ci-client', 'CI tester'),
  row('2', 'internal', 'ci-client', 'CI tester'),
  row('3', 'forbidden', 'chatgpt-grant', 'https://chatgpt.com/oauth/client'),
  row('4', 'not_found', null, null),
];

describe('filterAuditErrors', () => {
  it('returns every row when both filters are open', () => {
    expect(filterAuditErrors(rows, { errorType: 'all', clientKey: 'all' })).toHaveLength(4);
  });

  it('filters by error type so validation noise can be hidden', () => {
    const shown = filterAuditErrors(rows, { errorType: 'internal', clientKey: 'all' });
    expect(shown.map((item) => item.id)).toEqual(['2']);
  });

  it('filters by client so a test client can be hidden', () => {
    const shown = filterAuditErrors(rows, {
      errorType: 'all',
      clientKey: auditErrorClientKey(rows[2]!),
    });
    expect(shown.map((item) => item.id)).toEqual(['3']);
  });

  it('applies error type and client together', () => {
    const shown = filterAuditErrors(rows, {
      errorType: 'validation',
      clientKey: auditErrorClientKey(rows[0]!),
    });
    expect(shown.map((item) => item.id)).toEqual(['1']);
    const none = filterAuditErrors(rows, {
      errorType: 'forbidden',
      clientKey: auditErrorClientKey(rows[0]!),
    });
    expect(none).toEqual([]);
  });

  it('groups rows with no client id under one unknown key', () => {
    expect(auditErrorClientKey(rows[3]!)).toBe('unknown');
    const shown = filterAuditErrors(rows, { errorType: 'all', clientKey: 'unknown' });
    expect(shown.map((item) => item.id)).toEqual(['4']);
  });
});
