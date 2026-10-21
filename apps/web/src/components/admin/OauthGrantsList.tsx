'use client';

import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { applyTableView } from '../../lib/data-table';
import { useSyncEnumFilters, useTableState } from '../../lib/use-table-state';
import {
  oauthClientLabel,
  oauthClientOptions,
  oauthGrantListStatus,
  oauthGrantSearchBlob,
  type OauthGrantListStatus,
} from './oauth-grant-list';
import { LocalDateTime } from '../LocalDateTime';
import { Badge, Button, ErrorText, Input, Panel, useToast } from '../ui';
import { DataTable, dataTableFilterFields, type DataColumn } from '../ui/DataTable';
import { TableFilterControl } from '../ui/TableFilterControl';
import { ScopePreviewList } from './ScopePreviewList';

export type OauthGrantRow = {
  id: string;
  userId: string;
  userEmail: string | null;
  userDisplayName: string | null;
  organizationId: string;
  clientId?: string | null;
  clientHost: string;
  scopes: string[];
  allowedWorkspaceIds: string[];
  status: string;
  revokedAt?: string | null;
  lastUsedAt: string | null;
  refreshExpiresAt: string | null;
  createdAt: string;
};

const STATUS_OPTIONS: OauthGrantListStatus[] = ['active', 'revoked', 'expired'];

function userLabel(grant: OauthGrantRow): string {
  return grant.userDisplayName ?? grant.userEmail ?? grant.userId;
}

export function OauthGrantsList({
  grants,
  workspaceNames,
  revokeBase,
  showUser,
  title,
  blurb,
}: {
  grants: OauthGrantRow[];
  workspaceNames: Record<string, string>;
  revokeBase: string;
  showUser: boolean;
  title: string;
  blurb: string;
}) {
  const t = useTranslations('admin');
  const tConnections = useTranslations('aiConnections');
  const tTable = useTranslations('table');
  const locale = useLocale();
  const router = useRouter();
  const { pushToast } = useToast();
  const table = useTableState({
    namespace: 'oauthGrants',
    defaultSortKey: 'lastUsed',
    defaultSortDir: 'desc',
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clientOptions = useMemo(
    () => oauthClientOptions(grants).map((label) => ({ value: label, label })),
    [grants],
  );
  const statusOptions = useMemo(
    () =>
      STATUS_OPTIONS.map((value) => ({
        value,
        label:
          value === 'active'
            ? t('oauthGrantActive')
            : value === 'revoked'
              ? t('oauthGrantRevokedStatus')
              : t('oauthGrantExpired'),
      })),
    [t],
  );

  const grantStatusLabel = useCallback(
    (status: OauthGrantListStatus) =>
      statusOptions.find((option) => option.value === status)?.label ?? status,
    [statusOptions],
  );

  const mutateGrant = useCallback(
    async (grantId: string, action: 'revoke' | 'remove') => {
      setPending(true);
      setError(null);
      const failed =
        action === 'revoke' ? tConnections('revokeFailed') : t('oauthGrantRemoveFailed');
      try {
        const response = await fetch(
          action === 'revoke' ? `${revokeBase}/${grantId}/revoke` : `${revokeBase}/${grantId}`,
          {
            method: action === 'revoke' ? 'POST' : 'DELETE',
            credentials: 'include',
            headers: { Origin: window.location.origin },
          },
        );
        if (!response.ok) {
          const payload = (await response.json()) as { error?: { message?: string } };
          throw new Error(payload.error?.message ?? failed);
        }
        pushToast(action === 'revoke' ? t('oauthGrantRevoked') : t('oauthGrantRemoved'));
        router.refresh();
      } catch (err) {
        const message = err instanceof Error ? err.message : failed;
        setError(message);
        pushToast(message, 'danger');
      } finally {
        setPending(false);
      }
    },
    [pushToast, revokeBase, router, t, tConnections],
  );

  const columns = useMemo<Array<DataColumn<OauthGrantRow>>>(() => {
    const dateCell = (value: string | null) =>
      value ? <LocalDateTime value={value} locale={locale} /> : (
        <span className="text-ink-muted">{t('oauthGrantNever')}</span>
      );
    const cols: Array<DataColumn<OauthGrantRow>> = [];
    if (showUser) {
      cols.push({
        id: 'user',
        header: t('user'),
        kind: 'text',
        primary: true,
        sort: { type: 'text', getValue: (grant) => userLabel(grant) },
        cell: (grant) => userLabel(grant),
      });
    }
    cols.push(
      {
        id: 'client',
        header: t('oauthGrantColClient'),
        kind: 'text',
        primary: !showUser,
        sort: { type: 'text', getValue: (grant) => oauthClientLabel(grant.clientHost) },
        filter: {
          type: 'enum',
          getValue: (grant) => oauthClientLabel(grant.clientHost),
          options: clientOptions,
        },
        cell: (grant) => {
          const label = oauthClientLabel(grant.clientHost);
          const host = grant.clientHost.trim();
          return (
            <span>
              {label}
              {label.toLowerCase() !== host.toLowerCase() ? (
                <span className="block text-xs text-ink-muted">{host}</span>
              ) : null}
            </span>
          );
        },
      },
      {
        id: 'status',
        header: t('oauthGrantColStatus'),
        kind: 'status',
        sort: {
          type: 'text',
          getValue: (grant) => oauthGrantListStatus(grant, Date.now()),
        },
        filter: {
          type: 'enum',
          getValue: (grant) => oauthGrantListStatus(grant, Date.now()),
          options: statusOptions,
        },
        cell: (grant) => {
          const status = oauthGrantListStatus(grant, Date.now());
          const tone =
            status === 'active' ? 'success' : status === 'expired' ? 'warn' : 'neutral';
          return <Badge tone={tone}>{grantStatusLabel(status)}</Badge>;
        },
      },
      {
        id: 'scopes',
        header: t('scopes'),
        kind: 'data',
        cell: (grant) => (
          <ScopePreviewList
            scopes={grant.scopes}
            title={t('scopes')}
            moreLabel={(count) => t('oauthGrantScopesMore', { count })}
            hideLabel={t('oauthGrantScopesHide')}
          />
        ),
      },
      {
        id: 'workspaces',
        header: t('oauthGrantColWorkspaces'),
        kind: 'data',
        cell: (grant) => {
          const labels = grant.allowedWorkspaceIds.map((id) => workspaceNames[id] ?? id);
          if (labels.length === 0) return t('oauthGrantNoWorkspaces');
          const text = labels.join(', ');
          return (
            <span className="kh-ops-grant-wrap" title={text}>
              {text}
            </span>
          );
        },
      },
      {
        id: 'refresh',
        header: t('oauthGrantRefreshExpires'),
        kind: 'date',
        sort: {
          type: 'date',
          getValue: (grant) => grant.refreshExpiresAt,
          defaultDir: 'asc',
        },
        cell: (grant) => dateCell(grant.refreshExpiresAt),
      },
      {
        id: 'lastUsed',
        header: t('oauthGrantLastUsed'),
        kind: 'date',
        sort: {
          type: 'date',
          getValue: (grant) => grant.lastUsedAt,
          defaultDir: 'desc',
        },
        cell: (grant) => dateCell(grant.lastUsedAt),
      },
      {
        id: 'created',
        header: t('oauthGrantSortCreated'),
        kind: 'date',
        sort: {
          type: 'date',
          getValue: (grant) => grant.createdAt,
          defaultDir: 'desc',
        },
        cell: (grant) => <LocalDateTime value={grant.createdAt} locale={locale} />,
      },
      {
        id: 'actions',
        header: '',
        kind: 'actions',
        cell: (grant) =>
          grant.status === 'active' ? (
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() => void mutateGrant(grant.id, 'revoke')}
            >
              {t('oauthGrantRevoke')}
            </Button>
          ) : (
            <Button
              type="button"
              variant="danger"
              disabled={pending}
              onClick={() => void mutateGrant(grant.id, 'remove')}
            >
              {t('oauthGrantRemove')}
            </Button>
          ),
      },
    );
    return cols;
  }, [
    clientOptions,
    grantStatusLabel,
    locale,
    mutateGrant,
    pending,
    showUser,
    statusOptions,
    t,
    workspaceNames,
  ]);

  useSyncEnumFilters(table.filters, columns, table.setEnumFilter);

  const visible = useMemo(
    () =>
      applyTableView({
        rows: grants,
        locale,
        query: table.query,
        search: (grant, needle) => oauthGrantSearchBlob(grant).includes(needle),
        sortKey: table.sortKey,
        sortDir: table.sortDir,
        filters: table.filters,
        textFilters: table.textFilters,
        columns,
        tieBreak: (left, right) => left.id.localeCompare(right.id),
      }),
    [
      columns,
      grants,
      locale,
      table.filters,
      table.query,
      table.sortDir,
      table.sortKey,
      table.textFilters,
    ],
  );

  const bareEmpty = grants.length === 0 && !table.filtersActive && table.query.trim() === '';

  return (
    <Panel className="grid gap-4 p-4">
      <div>
        <h2 className="m-0 text-base font-semibold">{title}</h2>
        <p className="m-0 mt-1 text-sm text-ink-muted">{blurb}</p>
      </div>
      {error ? <ErrorText>{error}</ErrorText> : null}
      <div className="kh-ops-toolbar mb-0 border-0 border-b border-line">
        <label className="flex min-w-[220px] flex-1 items-center gap-2">
          <span className="sr-only">{t('oauthGrantSearch')}</span>
          <Input
            type="search"
            value={table.query}
            onChange={(event) => table.setQuery(event.target.value)}
            placeholder={t('oauthGrantSearch')}
            aria-label={t('oauthGrantSearch')}
            className="h-10 min-h-10 py-1.5 text-xs"
          />
        </label>
        <TableFilterControl
          fields={dataTableFilterFields(columns)}
          enumFilters={table.filters}
          textFilters={table.textFilters}
          onEnumFilter={table.setEnumFilter}
          onTextFilter={table.setTextFilter}
          onClearFilters={table.clearFilters}
          filtersActive={table.filtersActive}
        />
        {table.filtersActive ? (
          <Button
            type="button"
            variant="secondary"
            className="kh-ops-tree-filter-clear h-8 min-h-8 px-2 text-xs"
            onClick={table.clearFilters}
          >
            {tTable('clearFilters')}
          </Button>
        ) : null}
      </div>
      {bareEmpty ? (
        <p className="kh-ops-empty">{t('oauthGrantEmpty')}</p>
      ) : (
        <DataTable
          rows={visible}
          rowKey={(grant) => grant.id}
          columns={columns}
          sortKey={table.sortKey}
          sortDir={table.sortDir}
          onToggleSort={table.toggleSort}
          enumFilters={table.filters}
          textFilters={table.textFilters}
          onEnumFilter={table.setEnumFilter}
          onTextFilter={table.setTextFilter}
          onClearFilters={table.clearFilters}
          filtersActive={table.filtersActive}
          hideHeaderFilter
          tableClassName="kh-ops-wrap-table"
          empty={<p className="kh-ops-empty">{t('oauthGrantEmptyFiltered')}</p>}
        />
      )}
    </Panel>
  );
}
