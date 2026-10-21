'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  defaultOauthGrantListQuery,
  filterOauthGrants,
  oauthClientOptions,
  oauthGrantFiltersActive,
  oauthGrantListStatus,
  type OauthGrantListStatus,
  type OauthGrantSort,
  type OauthGrantStatusFilter,
} from './oauth-grant-list';
import { Badge, Button, ErrorText, FunctionHeader, Input, Panel, Select, useToast } from '../ui';

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

function formatWhen(value: string | null, neverLabel: string): string {
  if (!value) return neverLabel;
  return value.slice(0, 16).replace('T', ' ');
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
  const router = useRouter();
  const { pushToast } = useToast();
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<OauthGrantStatusFilter>('all');
  const [clientFilter, setClientFilter] = useState('all');
  const [sort, setSort] = useState<OauthGrantSort>('lastUsed');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const listQuery = useMemo(
    () => ({
      query,
      status: statusFilter,
      client: clientFilter,
      sort,
    }),
    [query, statusFilter, clientFilter, sort],
  );
  const filtersActive = oauthGrantFiltersActive(listQuery);
  const clientOptions = useMemo(() => oauthClientOptions(grants), [grants]);
  const visible = useMemo(
    () => filterOauthGrants(grants, listQuery, Date.now()),
    [grants, listQuery],
  );

  function clearGrantFilters() {
    const defaults = defaultOauthGrantListQuery();
    setQuery(defaults.query);
    setStatusFilter(defaults.status);
    setClientFilter(defaults.client);
    setSort(defaults.sort);
  }

  function grantStatusLabel(status: OauthGrantListStatus): string {
    if (status === 'active') return t('oauthGrantActive');
    if (status === 'revoked') return t('oauthGrantRevokedStatus');
    return t('oauthGrantExpired');
  }

  async function mutateGrant(grantId: string, action: 'revoke' | 'remove') {
    setPending(true);
    setError(null);
    const failed = action === 'revoke' ? tConnections('revokeFailed') : t('oauthGrantRemoveFailed');
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
  }

  return (
    <Panel className="grid gap-4 p-4">
      <div>
        <h2 className="m-0 text-base font-semibold">{title}</h2>
        <p className="m-0 mt-1 text-sm text-ink-muted">{blurb}</p>
      </div>
      <FunctionHeader
        search={
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('oauthGrantSearch')}
            aria-label={t('oauthGrantSearch')}
          />
        }
        filters={
          <>
            <Select
              className="kh-ops-inline-select"
              value={clientFilter}
              onChange={(event) => setClientFilter(event.target.value)}
              aria-label={t('oauthGrantFilterClient')}
            >
              <option value="all">{t('oauthGrantFilterAllClients')}</option>
              {clientOptions.map((label) => (
                <option key={label} value={label}>
                  {label}
                </option>
              ))}
            </Select>
            <Select
              className="kh-ops-inline-select"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as OauthGrantStatusFilter)}
              aria-label={t('oauthGrantFilterStatus')}
            >
              <option value="all">{t('oauthGrantFilterAll')}</option>
              <option value="active">{t('oauthGrantActive')}</option>
              <option value="revoked">{t('oauthGrantRevokedStatus')}</option>
              <option value="expired">{t('oauthGrantExpired')}</option>
            </Select>
            <Select
              className="kh-ops-inline-select"
              value={sort}
              onChange={(event) => setSort(event.target.value as OauthGrantSort)}
              aria-label={t('oauthGrantFilterSort')}
            >
              <option value="lastUsed">{t('oauthGrantSortLastUsed')}</option>
              <option value="created">{t('oauthGrantSortCreated')}</option>
            </Select>
            <span className="kh-ops-panel-meta whitespace-nowrap">
              {t('listResultCount', { shown: visible.length, total: grants.length })}
            </span>
          </>
        }
        actions={
          <Button
            type="button"
            variant="secondary"
            disabled={!filtersActive}
            onClick={clearGrantFilters}
          >
            {tTable('clearFilters')}
          </Button>
        }
      />
      {error ? <ErrorText>{error}</ErrorText> : null}
      {visible.length === 0 ? (
        <p className="kh-ops-empty">
          {grants.length === 0 ? t('oauthGrantEmpty') : t('oauthGrantEmptyFiltered')}
        </p>
      ) : (
        <div className="grid gap-3">
          {visible.map((grant) => {
            const status = oauthGrantListStatus(grant, Date.now());
            const tone =
              status === 'active' ? 'success' : status === 'expired' ? 'warn' : 'neutral';
            return (
              <div key={grant.id} className="grid gap-2 border-b border-line pb-3 last:border-0">
                <div className="flex flex-wrap items-center gap-2">
                  {showUser ? (
                    <span className="font-medium">
                      {grant.userDisplayName ?? grant.userEmail ?? grant.userId}
                    </span>
                  ) : null}
                  <Badge tone={tone}>{grantStatusLabel(status)}</Badge>
                  <span className="text-sm text-ink-muted">{grant.clientHost}</span>
                </div>
                <div className="kh-ops-scope-list kh-ops-scope-list--inline">
                  {grant.scopes.map((scope) => (
                    <span key={scope} className="kh-ops-tag">
                      {scope}
                    </span>
                  ))}
                </div>
                <p className="m-0 text-sm text-ink-muted">
                  {grant.allowedWorkspaceIds.map((id) => workspaceNames[id] ?? id).join(', ') ||
                    t('oauthGrantNoWorkspaces')}
                </p>
                <p className="m-0 text-xs text-ink-muted">
                  {t('oauthGrantRefreshExpires')}:{' '}
                  {formatWhen(grant.refreshExpiresAt, t('oauthGrantNever'))}
                  {' · '}
                  {t('oauthGrantLastUsed')}: {formatWhen(grant.lastUsedAt, t('oauthGrantNever'))}
                </p>
                <div>
                  {grant.status === 'active' ? (
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
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}
