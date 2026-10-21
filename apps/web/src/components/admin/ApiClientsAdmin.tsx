'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { applyTableView } from '../../lib/data-table';
import { useSyncEnumFilters, useTableState } from '../../lib/use-table-state';
import {
  apiClientListStatus,
  apiClientSearchBlob,
  type ApiClientListStatus,
} from './api-client-list';
import { LocalDateTime } from '../LocalDateTime';
import { Badge, Button, ErrorText, Field, Input, Modal, Select, useToast } from '../ui';
import { DataTable, dataTableFilterFields, type DataColumn } from '../ui/DataTable';
import { TableFilterControl } from '../ui/TableFilterControl';
import { ScopePreviewList } from './ScopePreviewList';

const MCP_SCOPES = [
  'projects:read',
  'systems:read',
  'knowledge:read',
  'knowledge:search',
  'provenance:read',
  'knowledge:write',
  'catalogue:write',
  'projects:write',
  'pm:read',
  'pm:write',
  'monitoring:read',
] as const;

function needsActingUser(scopes: readonly string[]): boolean {
  return (
    scopes.includes('knowledge:write') ||
    scopes.includes('catalogue:write') ||
    scopes.includes('projects:write') ||
    scopes.includes('pm:write') ||
    scopes.includes('pm:read')
  );
}

export type PublicApiClient = {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  tokenPrefix: string | null;
  scopes: string[];
  allowedWorkspaceIds: string[];
  allowedProjectIds: string[];
  actingUserId: string | null;
  status?: string;
  requestedByUserId?: string | null;
  agentLabel?: string | null;
  expiresAt: string | null;
  revokedAt?: string | null;
  lastUsedAt: string | null;
  createdAt: string;
};

type Org = { id: string; name: string; slug: string };
type Workspace = { id: string; name: string; slug: string; organizationId: string };
type User = { id: string; email: string; displayName: string };

const CLIENT_STATUS_FILTERS: ApiClientListStatus[] = [
  'active',
  'pending_approval',
  'revoked',
  'expired',
];

export function ApiClientsAdmin({
  initialClients,
  organizations,
  workspaces,
  users,
}: {
  initialClients: PublicApiClient[];
  organizations: Org[];
  workspaces: Workspace[];
  users: User[];
}) {
  const t = useTranslations('admin');
  const tCommon = useTranslations('common');
  const tTable = useTranslations('table');
  const locale = useLocale();
  const router = useRouter();
  const { pushToast } = useToast();
  const table = useTableState({
    namespace: 'apiClients',
    defaultSortKey: 'created',
    defaultSortDir: 'desc',
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [issuedToken, setIssuedToken] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [organizationId, setOrganizationId] = useState(organizations[0]?.id ?? '');
  const [scopes, setScopes] = useState<string[]>([
    'projects:read',
    'systems:read',
    'knowledge:read',
    'knowledge:search',
    'provenance:read',
  ]);
  const [allowedWorkspaceIds, setAllowedWorkspaceIds] = useState<string[]>([]);
  const [actingUserId, setActingUserId] = useState('');

  const [approveClient, setApproveClient] = useState<PublicApiClient | null>(null);
  const [approveScopes, setApproveScopes] = useState<string[]>([]);
  const [approveWorkspaces, setApproveWorkspaces] = useState<string[]>([]);
  const [approveError, setApproveError] = useState<string | null>(null);

  const [editClient, setEditClient] = useState<PublicApiClient | null>(null);
  const [editName, setEditName] = useState('');
  const [editScopes, setEditScopes] = useState<string[]>([]);
  const [editWorkspaces, setEditWorkspaces] = useState<string[]>([]);
  const [editActingUserId, setEditActingUserId] = useState('');
  const [editError, setEditError] = useState<string | null>(null);

  function clientStatusLabel(status: ApiClientListStatus): string {
    switch (status) {
      case 'active':
        return t('statusActive');
      case 'pending_approval':
        return t('statusPendingApproval');
      case 'revoked':
        return t('statusRevoked');
      case 'expired':
        return t('statusExpired');
      case 'rejected':
        return t('statusRejected');
    }
  }

  function renderClientStatus(client: PublicApiClient) {
    const status = apiClientListStatus(client, Date.now());
    const tone =
      status === 'active'
        ? 'success'
        : status === 'pending_approval'
          ? 'brand'
          : status === 'expired'
            ? 'warn'
            : status === 'rejected'
              ? 'danger'
              : 'neutral';
    return <Badge tone={tone}>{clientStatusLabel(status)}</Badge>;
  }

  const orgWorkspaces = useMemo(
    () => workspaces.filter((workspace) => workspace.organizationId === organizationId),
    [workspaces, organizationId],
  );

  const approveOrgWorkspaces = useMemo(() => {
    if (!approveClient) return [];
    return workspaces.filter(
      (workspace) => workspace.organizationId === approveClient.organizationId,
    );
  }, [workspaces, approveClient]);

  const editOrgWorkspaces = useMemo(() => {
    if (!editClient) return [];
    return workspaces.filter((workspace) => workspace.organizationId === editClient.organizationId);
  }, [workspaces, editClient]);

  function userLabel(userId: string | null | undefined): string {
    if (!userId) return '—';
    const user = users.find((item) => item.id === userId);
    return user ? `${user.displayName} (${user.email})` : userId;
  }

  function actingUserLabel(userId: string | null | undefined): string {
    if (!userId) return '—';
    const user = users.find((item) => item.id === userId);
    return user?.displayName ?? userId;
  }

  function orgName(orgId: string): string {
    return organizations.find((org) => org.id === orgId)?.name ?? '—';
  }

  function workspaceNames(ids: string[]): string {
    if (ids.length === 0) return t('workspacesAllowlistEmpty');
    return ids
      .map((id) => workspaces.find((workspace) => workspace.id === id)?.name ?? id)
      .join(', ');
  }

  function resetCreateForm() {
    setName('');
    setOrganizationId(organizations[0]?.id ?? '');
    setScopes([
      'projects:read',
      'systems:read',
      'knowledge:read',
      'knowledge:search',
      'provenance:read',
    ]);
    setAllowedWorkspaceIds([]);
    setActingUserId('');
    setError(null);
  }

  function closeCreateModal() {
    setCreateOpen(false);
    resetCreateForm();
  }

  function openApprove(client: PublicApiClient) {
    setApproveClient(client);
    setApproveScopes([...client.scopes]);
    setApproveWorkspaces([...client.allowedWorkspaceIds]);
    setApproveError(null);
  }

  function openEdit(client: PublicApiClient) {
    setEditClient(client);
    setEditName(client.name);
    setEditScopes([...client.scopes]);
    setEditWorkspaces([...client.allowedWorkspaceIds]);
    setEditActingUserId(client.actingUserId ?? '');
    setEditError(null);
  }

  function closeEditModal() {
    setEditClient(null);
    setEditError(null);
  }

  async function createClient() {
    setPending(true);
    setError(null);
    setIssuedToken(null);
    try {
      const response = await fetch('/api/v1/api-clients', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organizationId,
          name,
          scopes,
          allowedWorkspaceIds,
          actingUserId: actingUserId || null,
        }),
      });
      const payload = (await response.json()) as {
        token?: string;
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? t('failed'));
      }
      const createdName = name;
      setIssuedToken(payload.token ?? null);
      closeCreateModal();
      pushToast(t('toastApiClientCreated', { name: createdName }));
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : t('failed');
      setError(message);
      pushToast(message, 'danger');
    } finally {
      setPending(false);
    }
  }

  async function approvePending() {
    if (!approveClient) return;
    setPending(true);
    setApproveError(null);
    try {
      const response = await fetch(`/api/v1/api-clients/${approveClient.id}/approve`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Origin: window.location.origin,
        },
        body: JSON.stringify({
          scopes: approveScopes,
          allowedWorkspaceIds: approveWorkspaces,
        }),
      });
      const payload = (await response.json()) as {
        token?: string;
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? t('failed'));
      }
      setIssuedToken(payload.token ?? null);
      setApproveClient(null);
      pushToast(t('toastApiClientApproved'));
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : t('failed');
      setApproveError(message);
      pushToast(message, 'danger');
    } finally {
      setPending(false);
    }
  }

  async function rejectPending(clientId: string) {
    setPending(true);
    try {
      const response = await fetch(`/api/v1/api-clients/${clientId}/reject`, {
        method: 'POST',
        credentials: 'include',
        headers: { Origin: window.location.origin },
      });
      const payload = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? t('failed'));
      }
      pushToast(t('toastApiClientRejected'));
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : t('failed');
      pushToast(message, 'danger');
    } finally {
      setPending(false);
    }
  }

  async function saveEdit() {
    if (!editClient) return;
    setPending(true);
    setEditError(null);
    try {
      const response = await fetch(`/api/v1/api-clients/${editClient.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Origin: window.location.origin,
        },
        body: JSON.stringify({
          name: editName.trim(),
          scopes: editScopes,
          allowedWorkspaceIds: editWorkspaces,
          actingUserId: editActingUserId || null,
        }),
      });
      const payload = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? t('failed'));
      }
      const updatedName = editName.trim();
      closeEditModal();
      pushToast(t('toastApiClientUpdated', { name: updatedName }));
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : t('failed');
      setEditError(message);
      pushToast(message, 'danger');
    } finally {
      setPending(false);
    }
  }

  async function rotate(clientId: string) {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/api-clients/${clientId}/rotate`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Origin: window.location.origin },
        body: '{}',
      });
      const payload = (await response.json()) as {
        token?: string;
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? t('failed'));
      }
      setIssuedToken(payload.token ?? null);
      pushToast(t('toastApiClientRotated'));
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : t('failed');
      setError(message);
      pushToast(message, 'danger');
    } finally {
      setPending(false);
    }
  }

  async function revoke(clientId: string) {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/api-clients/${clientId}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { Origin: window.location.origin },
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: { message?: string } };
        throw new Error(payload.error?.message ?? t('failed'));
      }
      pushToast(t('toastApiClientRevoked'));
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : t('failed');
      setError(message);
      pushToast(message, 'danger');
    } finally {
      setPending(false);
    }
  }

  function toggleScope(scope: string, target: 'create' | 'approve' | 'edit') {
    const setter =
      target === 'create' ? setScopes : target === 'approve' ? setApproveScopes : setEditScopes;
    setter((current) =>
      current.includes(scope) ? current.filter((item) => item !== scope) : [...current, scope],
    );
  }

  function toggleWorkspace(workspaceId: string, target: 'create' | 'approve' | 'edit') {
    const setter =
      target === 'create'
        ? setAllowedWorkspaceIds
        : target === 'approve'
          ? setApproveWorkspaces
          : setEditWorkspaces;
    setter((current) =>
      current.includes(workspaceId)
        ? current.filter((item) => item !== workspaceId)
        : [...current, workspaceId],
    );
  }

  const statusOptions = useMemo(
    () =>
      CLIENT_STATUS_FILTERS.map((value) => ({
        value,
        label: clientStatusLabel(value),
      })),
    // clientStatusLabel only reads translation keys.
    [t],
  );
  const scopeOptions = useMemo(
    () => MCP_SCOPES.map((scope) => ({ value: scope, label: scope })),
    [],
  );

  const columns = useMemo<Array<DataColumn<PublicApiClient>>>(() => {
    const dateCell = (value: string | null) =>
      value ? (
        <LocalDateTime value={value} locale={locale} />
      ) : (
        <span className="text-ink-muted">{t('monitoringNever')}</span>
      );
    return [
      {
        id: 'name',
        header: t('colName'),
        kind: 'text',
        primary: true,
        sort: { type: 'text', getValue: (client) => client.name },
        cell: (client) => (
          <span>
            {client.name}
            {client.tokenPrefix ? (
              <span className="mt-0.5 block text-xs text-ink-muted">{client.tokenPrefix}…</span>
            ) : null}
            {apiClientListStatus(client, Date.now()) === 'pending_approval' ? (
              <span className="mt-0.5 block text-xs text-ink-muted">
                {t('requestedBy')}: {userLabel(client.requestedByUserId)}
              </span>
            ) : null}
          </span>
        ),
      },
      {
        id: 'organization',
        header: t('organization'),
        kind: 'text',
        sort: { type: 'text', getValue: (client) => orgName(client.organizationId) },
        cell: (client) => orgName(client.organizationId),
      },
      {
        id: 'scopes',
        header: t('colScopes'),
        kind: 'data',
        filter: {
          type: 'enum',
          getValue: (client) => client.scopes,
          options: scopeOptions,
        },
        cell: (client) => (
          <ScopePreviewList
            scopes={client.scopes}
            title={t('scopes')}
            moreLabel={(count) => t('oauthGrantScopesMore', { count })}
            hideLabel={t('oauthGrantScopesHide')}
          />
        ),
      },
      {
        id: 'workspaces',
        header: t('allowedWorkspaces'),
        kind: 'text',
        cell: (client) => {
          const text = workspaceNames(client.allowedWorkspaceIds);
          return (
            <span className="kh-ops-grant-wrap" title={text}>
              {text}
            </span>
          );
        },
      },
      {
        id: 'actingUser',
        header: t('actingUser'),
        kind: 'text',
        cell: (client) => actingUserLabel(client.actingUserId),
      },
      {
        id: 'lastUsed',
        header: t('lastUsed'),
        kind: 'date',
        sort: {
          type: 'date',
          getValue: (client) => client.lastUsedAt,
          defaultDir: 'desc',
        },
        cell: (client) => dateCell(client.lastUsedAt),
      },
      {
        id: 'created',
        header: t('apiClientsSortCreated'),
        kind: 'date',
        sort: {
          type: 'date',
          getValue: (client) => client.createdAt,
          defaultDir: 'desc',
        },
        cell: (client) => <LocalDateTime value={client.createdAt} locale={locale} />,
      },
      {
        id: 'status',
        header: t('colStatus'),
        kind: 'status',
        sort: {
          type: 'text',
          getValue: (client) => apiClientListStatus(client, Date.now()),
        },
        filter: {
          type: 'enum',
          getValue: (client) => apiClientListStatus(client, Date.now()),
          options: statusOptions,
        },
        cell: (client) => (
          <span className="inline-flex flex-wrap items-center gap-1">
            {renderClientStatus(client)}
            {client.agentLabel ? <Badge tone="neutral">{client.agentLabel}</Badge> : null}
          </span>
        ),
      },
      {
        id: 'actions',
        header: '',
        kind: 'actions',
        cell: (client) => {
          const status = apiClientListStatus(client, Date.now());
          if (status === 'pending_approval') {
            return (
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  className="h-8 min-h-8 px-2 text-xs"
                  disabled={pending}
                  onClick={() => openApprove(client)}
                >
                  {t('approveApiClient')}
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  className="h-8 min-h-8 px-2 text-xs"
                  disabled={pending}
                  onClick={() => void rejectPending(client.id)}
                >
                  {t('rejectApiClient')}
                </Button>
              </div>
            );
          }
          if (status !== 'active' && status !== 'expired') return null;
          return (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                className="h-8 min-h-8 px-2 text-xs"
                disabled={pending}
                onClick={() => openEdit(client)}
              >
                {t('editApiClient')}
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="h-8 min-h-8 px-2 text-xs"
                disabled={pending}
                onClick={() => void rotate(client.id)}
              >
                {t('rotate')}
              </Button>
              <Button
                type="button"
                variant="danger"
                className="h-8 min-h-8 px-2 text-xs"
                disabled={pending}
                onClick={() => void revoke(client.id)}
              >
                {t('revoke')}
              </Button>
            </div>
          );
        },
      },
    ];
    // Row actions close over the latest setters. pending refreshes the disabled state.
  }, [locale, organizations, pending, scopeOptions, statusOptions, t, users, workspaces]);

  useSyncEnumFilters(table.filters, columns, table.setEnumFilter);

  const visible = useMemo(
    () =>
      applyTableView({
        rows: initialClients,
        locale,
        query: table.query,
        search: (client, needle) => apiClientSearchBlob(client, users).includes(needle),
        sortKey: table.sortKey,
        sortDir: table.sortDir,
        filters: table.filters,
        textFilters: table.textFilters,
        columns,
        tieBreak: (left, right) => left.id.localeCompare(right.id),
      }),
    [
      columns,
      initialClients,
      locale,
      table.filters,
      table.query,
      table.sortDir,
      table.sortKey,
      table.textFilters,
      users,
    ],
  );
  const pendingClients = visible.filter(
    (client) => apiClientListStatus(client, Date.now()) === 'pending_approval',
  );
  const listedClients = visible.filter(
    (client) => apiClientListStatus(client, Date.now()) !== 'pending_approval',
  );
  const bareEmpty =
    initialClients.length === 0 && !table.filtersActive && table.query.trim() === '';

  function renderClientTable(rows: PublicApiClient[]) {
    return (
      <DataTable
        rows={rows}
        rowKey={(client) => client.id}
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
      />
    );
  }

  return (
    <div className="grid gap-6">
      {issuedToken ? (
        <div className="kh-ops-status-row" data-tone="warn">
          <div>
            <p className="font-medium text-accent">{t('tokenOnce')}</p>
            <code className="kh-ops-code mt-2 block break-all">{issuedToken}</code>
          </div>
        </div>
      ) : null}

      <div className="kh-ops-toolbar mb-0 border-0 border-b border-line">
        <label className="flex min-w-[220px] flex-1 items-center gap-2">
          <span className="sr-only">{t('apiClientsSearchPlaceholder')}</span>
          <Input
            type="search"
            value={table.query}
            onChange={(event) => table.setQuery(event.target.value)}
            placeholder={t('apiClientsSearchPlaceholder')}
            aria-label={t('apiClientsSearchPlaceholder')}
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
        <Button
          type="button"
          disabled={pending || organizations.length === 0}
          onClick={() => {
            resetCreateForm();
            setCreateOpen(true);
          }}
        >
          {t('createClient')}
        </Button>
      </div>

      <Modal
        open={createOpen}
        onClose={closeCreateModal}
        title={t('createClient')}
        size="lg"
        footer={
          <>
            <Button type="button" variant="secondary" disabled={pending} onClick={closeCreateModal}>
              {tCommon('cancel')}
            </Button>
            <Button
              type="button"
              disabled={pending || !name || !organizationId}
              onClick={() => void createClient()}
            >
              {t('create')}
            </Button>
          </>
        }
      >
        <Field label={tCommon('name')}>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            data-modal-initial-focus
          />
        </Field>
        <Field label={t('organization')}>
          <Select
            value={organizationId}
            onChange={(e) => {
              setOrganizationId(e.target.value);
              setAllowedWorkspaceIds([]);
            }}
          >
            {organizations.map((org) => (
              <option key={org.id} value={org.id}>
                {org.name}
              </option>
            ))}
          </Select>
        </Field>
        <fieldset className="m-0 grid gap-2 border-0 p-0">
          <legend className="mb-1 text-sm font-medium">{t('scopes')}</legend>
          <div className="kh-ops-scope-checks">
            {MCP_SCOPES.map((scope) => (
              <label key={scope} className="kh-ops-scope-check">
                <input
                  type="checkbox"
                  checked={scopes.includes(scope)}
                  onChange={() => toggleScope(scope, 'create')}
                />
                <span className="font-mono text-xs">{scope}</span>
              </label>
            ))}
          </div>
          {needsActingUser(scopes) ? (
            <p className="m-0 text-xs text-ink-muted">{t('writeScopeHint')}</p>
          ) : null}
        </fieldset>
        <fieldset className="m-0 grid gap-2 border-0 p-0">
          <legend className="mb-1 text-sm font-medium">{t('allowedWorkspaces')}</legend>
          <div className="kh-ops-scope-checks max-h-40 overflow-auto">
            {orgWorkspaces.length === 0 ? (
              <p className="m-0 text-sm text-ink-muted">{tCommon('none')}</p>
            ) : (
              orgWorkspaces.map((workspace) => (
                <label key={workspace.id} className="kh-ops-scope-check">
                  <input
                    type="checkbox"
                    checked={allowedWorkspaceIds.includes(workspace.id)}
                    onChange={() => toggleWorkspace(workspace.id, 'create')}
                  />
                  {workspace.name}
                </label>
              ))
            )}
          </div>
        </fieldset>
        <Field label={t('actingUser')}>
          <Select value={actingUserId} onChange={(e) => setActingUserId(e.target.value)}>
            <option value="">{tCommon('none')}</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.displayName} ({user.email})
              </option>
            ))}
          </Select>
        </Field>
        {error ? <ErrorText>{error}</ErrorText> : null}
      </Modal>

      <Modal
        open={approveClient != null}
        onClose={() => setApproveClient(null)}
        title={t('approveApiClient')}
        description={approveClient?.name}
        size="lg"
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() => setApproveClient(null)}
            >
              {tCommon('cancel')}
            </Button>
            <Button
              type="button"
              disabled={pending || approveScopes.length === 0}
              onClick={() => void approvePending()}
            >
              {t('approveApiClientConfirm')}
            </Button>
          </>
        }
      >
        {approveClient ? (
          <div className="grid gap-3">
            <p className="m-0 text-sm text-ink-muted">
              {t('approveApiClientHint', {
                user: userLabel(approveClient.requestedByUserId),
              })}
            </p>
            <fieldset className="m-0 grid gap-2 border-0 p-0">
              <legend className="mb-1 text-sm font-medium">{t('scopes')}</legend>
              <div className="kh-ops-scope-checks">
                {MCP_SCOPES.map((scope) => (
                  <label key={scope} className="kh-ops-scope-check">
                    <input
                      type="checkbox"
                      checked={approveScopes.includes(scope)}
                      onChange={() => toggleScope(scope, 'approve')}
                    />
                    <span className="font-mono text-xs">{scope}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset className="m-0 grid gap-2 border-0 p-0">
              <legend className="mb-1 text-sm font-medium">{t('allowedWorkspaces')}</legend>
              <div className="kh-ops-scope-checks max-h-40 overflow-auto">
                {approveOrgWorkspaces.map((workspace) => (
                  <label key={workspace.id} className="kh-ops-scope-check">
                    <input
                      type="checkbox"
                      checked={approveWorkspaces.includes(workspace.id)}
                      onChange={() => toggleWorkspace(workspace.id, 'approve')}
                    />
                    {workspace.name}
                  </label>
                ))}
              </div>
            </fieldset>
            {approveError ? <ErrorText>{approveError}</ErrorText> : null}
          </div>
        ) : null}
      </Modal>

      <Modal
        open={editClient != null}
        onClose={closeEditModal}
        title={t('editApiClient')}
        description={editClient?.name}
        size="lg"
        footer={
          <>
            <Button type="button" variant="secondary" disabled={pending} onClick={closeEditModal}>
              {tCommon('cancel')}
            </Button>
            <Button
              type="button"
              disabled={
                pending ||
                !editName.trim() ||
                editScopes.length === 0 ||
                (needsActingUser(editScopes) && (editWorkspaces.length === 0 || !editActingUserId))
              }
              onClick={() => void saveEdit()}
            >
              {tCommon('save')}
            </Button>
          </>
        }
      >
        {editClient ? (
          <div className="grid gap-3">
            <p className="m-0 text-sm text-ink-muted">{t('editApiClientHint')}</p>
            <Field label={tCommon('name')}>
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                required
                data-modal-initial-focus
              />
            </Field>
            <fieldset className="m-0 grid gap-2 border-0 p-0">
              <legend className="mb-1 text-sm font-medium">{t('scopes')}</legend>
              <div className="kh-ops-scope-checks">
                {MCP_SCOPES.map((scope) => (
                  <label key={scope} className="kh-ops-scope-check">
                    <input
                      type="checkbox"
                      checked={editScopes.includes(scope)}
                      onChange={() => toggleScope(scope, 'edit')}
                    />
                    <span className="font-mono text-xs">{scope}</span>
                  </label>
                ))}
              </div>
              {needsActingUser(editScopes) ? (
                <p className="m-0 text-xs text-ink-muted">{t('writeScopeHint')}</p>
              ) : null}
            </fieldset>
            <fieldset className="m-0 grid gap-2 border-0 p-0">
              <legend className="mb-1 text-sm font-medium">{t('allowedWorkspaces')}</legend>
              <p className="m-0 text-xs text-ink-muted">{t('workspacesAllowlistHint')}</p>
              <div className="kh-ops-scope-checks max-h-40 overflow-auto">
                {editOrgWorkspaces.length === 0 ? (
                  <p className="m-0 text-sm text-ink-muted">{tCommon('none')}</p>
                ) : (
                  editOrgWorkspaces.map((workspace) => (
                    <label key={workspace.id} className="kh-ops-scope-check">
                      <input
                        type="checkbox"
                        checked={editWorkspaces.includes(workspace.id)}
                        onChange={() => toggleWorkspace(workspace.id, 'edit')}
                      />
                      {workspace.name}
                    </label>
                  ))
                )}
              </div>
            </fieldset>
            <Field label={t('actingUser')}>
              <Select
                value={editActingUserId}
                onChange={(e) => setEditActingUserId(e.target.value)}
              >
                <option value="">{tCommon('none')}</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.displayName} ({user.email})
                  </option>
                ))}
              </Select>
            </Field>
            {editError ? <ErrorText>{editError}</ErrorText> : null}
          </div>
        ) : null}
      </Modal>

      {pendingClients.length > 0 ? (
        <section className="kh-ops-panel">
          <div className="kh-ops-panel-head">
            <h2 className="kh-ops-panel-title">{t('pendingApiClientsTitle')}</h2>
          </div>
          <p className="m-0 px-3 pt-3 text-sm text-ink-muted">{t('pendingApiClientsHint')}</p>
          {renderClientTable(pendingClients)}
        </section>
      ) : null}

      {listedClients.length > 0 ? (
        <section className="kh-ops-panel">
          {pendingClients.length > 0 ? (
            <div className="kh-ops-panel-head">
              <h2 className="kh-ops-panel-title">
                {listedClients.every(
                  (client) => apiClientListStatus(client, Date.now()) === 'active',
                )
                  ? t('activeApiClientsTitle')
                  : t('apiClients')}
              </h2>
            </div>
          ) : null}
          {renderClientTable(listedClients)}
        </section>
      ) : pendingClients.length === 0 ? (
        <section className="kh-ops-panel">
          <p className="kh-ops-empty">
            {bareEmpty ? t('emptyClients') : t('emptyClientsFiltered')}
          </p>
        </section>
      ) : null}
    </div>
  );
}
