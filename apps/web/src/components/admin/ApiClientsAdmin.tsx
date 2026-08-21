'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  Badge,
  Button,
  ErrorText,
  Field,
  FunctionHeader,
  Input,
  Modal,
  Select,
  useToast,
} from '../ui';

const MCP_SCOPES = [
  'projects:read',
  'systems:read',
  'knowledge:read',
  'knowledge:search',
  'provenance:read',
  'knowledge:write',
  'catalogue:write',
  'pm:read',
  'pm:write',
  'monitoring:read',
] as const;

function needsActingUser(scopes: readonly string[]): boolean {
  return (
    scopes.includes('knowledge:write') ||
    scopes.includes('catalogue:write') ||
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
  lastUsedAt: string | null;
  createdAt: string;
};

type Org = { id: string; name: string; slug: string };
type Workspace = { id: string; name: string; slug: string; organizationId: string };
type User = { id: string; email: string; displayName: string };

type StatusFilter = 'all' | 'active' | 'pending_approval';

function matchesClientSearch(client: PublicApiClient, query: string): boolean {
  if (!query) return true;
  const haystack = [
    client.name,
    client.description ?? '',
    client.tokenPrefix ?? '',
    client.agentLabel ?? '',
    client.scopes.join(' '),
    client.status ?? '',
  ]
    .join(' ')
    .toLowerCase();
  return haystack.includes(query);
}

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
  const router = useRouter();
  const { pushToast } = useToast();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

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

  const filteredClients = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return initialClients.filter((client) => {
      const status = client.status ?? 'active';
      if (statusFilter !== 'all' && status !== statusFilter) return false;
      return matchesClientSearch(client, query);
    });
  }, [initialClients, searchQuery, statusFilter]);

  const pendingClients = useMemo(
    () => filteredClients.filter((client) => client.status === 'pending_approval'),
    [filteredClients],
  );
  const activeClients = useMemo(
    () =>
      filteredClients.filter(
        (client) => (client.status ?? 'active') === 'active',
      ),
    [filteredClients],
  );

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
    return workspaces.filter(
      (workspace) => workspace.organizationId === editClient.organizationId,
    );
  }, [workspaces, editClient]);

  function userLabel(userId: string | null | undefined): string {
    if (!userId) return '—';
    const user = users.find((item) => item.id === userId);
    return user ? `${user.displayName} (${user.email})` : userId;
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
      const response = await fetch(
        `/api/v1/api-clients/${approveClient.id}/approve`,
        {
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
        },
      );
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
      target === 'create'
        ? setScopes
        : target === 'approve'
          ? setApproveScopes
          : setEditScopes;
    setter((current) =>
      current.includes(scope)
        ? current.filter((item) => item !== scope)
        : [...current, scope],
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

  return (
    <div className="grid gap-6">
      {issuedToken ? (
        <div className="kh-ops-status-row" data-tone="warn">
          <div>
            <p className="font-medium text-accent">{t('tokenOnce')}</p>
            <code className="kh-ops-code mt-2 block break-all">
              {issuedToken}
            </code>
          </div>
        </div>
      ) : null}

      <FunctionHeader
        search={
          <Input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('apiClientsSearchPlaceholder')}
            aria-label={t('apiClientsSearchPlaceholder')}
          />
        }
        filters={
          <Select
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(e.target.value as StatusFilter)
            }
            aria-label={t('apiClientsFilterStatus')}
          >
            <option value="all">{t('apiClientsFilterAll')}</option>
            <option value="active">{t('statusActive')}</option>
            <option value="pending_approval">{t('statusPendingApproval')}</option>
          </Select>
        }
        actions={
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
        }
      />

      <Modal
        open={createOpen}
        onClose={closeCreateModal}
        title={t('createClient')}
        size="lg"
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={closeCreateModal}
            >
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
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={closeEditModal}
            >
              {tCommon('cancel')}
            </Button>
            <Button
              type="button"
              disabled={
                pending ||
                !editName.trim() ||
                editScopes.length === 0 ||
                (needsActingUser(editScopes) &&
                  (editWorkspaces.length === 0 || !editActingUserId))
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
                    <label
                      key={workspace.id}
                      className="kh-ops-scope-check"
                    >
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
          <p className="m-0 px-3 pt-3 text-[11px] text-ink-muted">
            {t('pendingApiClientsHint')}
          </p>
          <div className="kh-ops-table-wrap">
            <table className="kh-ops-data-table">
              <thead>
                <tr>
                  <th>{t('colName')}</th>
                  <th>{t('colStatus')}</th>
                  <th>{t('colScopes')}</th>
                  <th>{t('colActions')}</th>
                </tr>
              </thead>
              <tbody>
                {pendingClients.map((client) => (
                  <tr key={client.id}>
                    <td className="kh-ops-primary-cell">
                      {client.name}
                      <div className="text-[11px] font-normal text-ink-muted">
                        {t('requestedBy')}: {userLabel(client.requestedByUserId)}
                      </div>
                    </td>
                    <td>
                      <Badge tone="brand">{t('statusPendingApproval')}</Badge>
                      {client.agentLabel ? (
                        <Badge tone="neutral">{client.agentLabel}</Badge>
                      ) : null}
                    </td>
                    <td className="font-mono text-[11px]">
                      {client.scopes.join(', ')}
                    </td>
                    <td>
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
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="kh-ops-panel">
        {pendingClients.length > 0 ? (
          <div className="kh-ops-panel-head">
            <h2 className="kh-ops-panel-title">{t('activeApiClientsTitle')}</h2>
          </div>
        ) : null}
        {filteredClients.length === 0 ? (
          <p className="kh-ops-empty">
            {initialClients.length === 0
              ? t('emptyClients')
              : t('emptyClientsFiltered')}
          </p>
        ) : activeClients.length === 0 ? (
          <p className="kh-ops-empty">{t('emptyActiveClientsFiltered')}</p>
        ) : (
          <div className="kh-ops-table-wrap">
            <table className="kh-ops-data-table">
              <thead>
                <tr>
                  <th>{t('colName')}</th>
                  <th>{t('tokenPrefix')}</th>
                  <th>{t('colScopes')}</th>
                  <th>{t('colActions')}</th>
                </tr>
              </thead>
              <tbody>
                {activeClients.map((client) => (
                  <tr key={client.id}>
                    <td className="kh-ops-primary-cell">
                      {client.name}
                      <div className="text-[11px] font-normal text-ink-muted">
                        {t('allowedWorkspaces')}:{' '}
                        {workspaceNames(client.allowedWorkspaceIds)}
                      </div>
                    </td>
                    <td className="font-mono">{client.tokenPrefix ?? '—'}</td>
                    <td className="font-mono text-[11px]">
                      {client.scopes.join(', ')}
                    </td>
                    <td>
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
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
