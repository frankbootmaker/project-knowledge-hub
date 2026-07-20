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
  Panel,
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
] as const;

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

const STATUS_FILTERS = ['all', 'active', 'pending_approval'] as const;

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
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]>('all');

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

  function userLabel(userId: string | null | undefined): string {
    if (!userId) return '—';
    const user = users.find((item) => item.id === userId);
    return user ? `${user.displayName} (${user.email})` : userId;
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

  function toggleScope(scope: string, target: 'create' | 'approve') {
    if (target === 'create') {
      setScopes((current) =>
        current.includes(scope)
          ? current.filter((item) => item !== scope)
          : [...current, scope],
      );
      return;
    }
    setApproveScopes((current) =>
      current.includes(scope)
        ? current.filter((item) => item !== scope)
        : [...current, scope],
    );
  }

  function toggleWorkspace(workspaceId: string, target: 'create' | 'approve') {
    if (target === 'create') {
      setAllowedWorkspaceIds((current) =>
        current.includes(workspaceId)
          ? current.filter((item) => item !== workspaceId)
          : [...current, workspaceId],
      );
      return;
    }
    setApproveWorkspaces((current) =>
      current.includes(workspaceId)
        ? current.filter((item) => item !== workspaceId)
        : [...current, workspaceId],
    );
  }

  return (
    <div className="grid gap-6">
      {issuedToken ? (
        <Panel className="border-accent/30 bg-accent-soft/40">
          <p className="mt-0 mb-2 text-sm font-medium text-accent">{t('tokenOnce')}</p>
          <code className="block break-all rounded-md bg-panel-solid px-3 py-2 font-mono text-sm">
            {issuedToken}
          </code>
        </Panel>
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
              setStatusFilter(e.target.value as (typeof STATUS_FILTERS)[number])
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
          <div className="grid gap-2 sm:grid-cols-2">
            {MCP_SCOPES.map((scope) => (
              <label key={scope} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={scopes.includes(scope)}
                  onChange={() => toggleScope(scope, 'create')}
                />
                <span className="font-mono text-xs">{scope}</span>
              </label>
            ))}
          </div>
          {scopes.includes('knowledge:write') ? (
            <p className="m-0 text-xs text-ink-muted">{t('writeScopeHint')}</p>
          ) : null}
        </fieldset>
        <fieldset className="m-0 grid gap-2 border-0 p-0">
          <legend className="mb-1 text-sm font-medium">{t('allowedWorkspaces')}</legend>
          <div className="grid max-h-40 gap-2 overflow-auto rounded-md border border-line p-3">
            {orgWorkspaces.length === 0 ? (
              <p className="m-0 text-sm text-ink-muted">{tCommon('none')}</p>
            ) : (
              orgWorkspaces.map((workspace) => (
                <label key={workspace.id} className="flex items-center gap-2 text-sm">
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
              <div className="grid gap-2 sm:grid-cols-2">
                {MCP_SCOPES.map((scope) => (
                  <label key={scope} className="flex items-center gap-2 text-sm">
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
              <div className="grid max-h-40 gap-2 overflow-auto rounded-md border border-line p-3">
                {approveOrgWorkspaces.map((workspace) => (
                  <label key={workspace.id} className="flex items-center gap-2 text-sm">
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

      {pendingClients.length > 0 ? (
        <section className="grid gap-3">
          <h2 className="m-0 text-base font-semibold">{t('pendingApiClientsTitle')}</h2>
          <p className="m-0 text-sm text-ink-muted">{t('pendingApiClientsHint')}</p>
          {pendingClients.map((client) => (
            <Panel key={client.id} className="grid gap-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="m-0 text-base font-semibold">{client.name}</h3>
                    <Badge tone="brand">{t('statusPendingApproval')}</Badge>
                    {client.agentLabel ? (
                      <Badge tone="neutral">{client.agentLabel}</Badge>
                    ) : null}
                  </div>
                  <p className="mt-1 mb-0 text-sm text-ink-muted">
                    {t('requestedBy')}: {userLabel(client.requestedByUserId)}
                  </p>
                  <p className="mt-1 mb-0 font-mono text-xs text-ink-muted">
                    {client.scopes.join(', ')}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    disabled={pending}
                    onClick={() => openApprove(client)}
                  >
                    {t('approveApiClient')}
                  </Button>
                  <Button
                    type="button"
                    variant="danger"
                    disabled={pending}
                    onClick={() => void rejectPending(client.id)}
                  >
                    {t('rejectApiClient')}
                  </Button>
                </div>
              </div>
            </Panel>
          ))}
        </section>
      ) : null}

      <section className="grid gap-3">
        {pendingClients.length > 0 ? (
          <h2 className="m-0 text-base font-semibold">{t('activeApiClientsTitle')}</h2>
        ) : null}
        {filteredClients.length === 0 ? (
          <p className="kh-muted">
            {initialClients.length === 0
              ? t('emptyClients')
              : t('emptyClientsFiltered')}
          </p>
        ) : activeClients.length === 0 ? (
          <p className="kh-muted">{t('emptyActiveClientsFiltered')}</p>
        ) : (
          activeClients.map((client) => (
            <Panel key={client.id} className="grid gap-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="m-0 text-base font-semibold">{client.name}</h3>
                  <p className="mt-1 mb-0 text-sm text-ink-muted">
                    {t('tokenPrefix')}:{' '}
                    <span className="font-mono">{client.tokenPrefix ?? '—'}</span>
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={pending}
                    onClick={() => void rotate(client.id)}
                  >
                    {t('rotate')}
                  </Button>
                  <Button
                    type="button"
                    variant="danger"
                    disabled={pending}
                    onClick={() => void revoke(client.id)}
                  >
                    {t('revoke')}
                  </Button>
                </div>
              </div>
              <p className="m-0 font-mono text-xs text-ink-muted">
                {client.scopes.join(', ')}
              </p>
              <p className="m-0 text-xs text-ink-muted">
                {t('created')}: {new Date(client.createdAt).toLocaleString()}
                {client.lastUsedAt
                  ? ` · ${t('lastUsed')}: ${new Date(client.lastUsedAt).toLocaleString()}`
                  : ''}
              </p>
            </Panel>
          ))
        )}
      </section>
    </div>
  );
}
