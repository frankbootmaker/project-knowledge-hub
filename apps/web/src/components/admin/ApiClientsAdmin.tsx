'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  Button,
  ErrorText,
  Field,
  Input,
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
  tokenPrefix: string;
  scopes: string[];
  allowedWorkspaceIds: string[];
  allowedProjectIds: string[];
  actingUserId: string | null;
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
};

type Org = { id: string; name: string; slug: string };
type Workspace = { id: string; name: string; slug: string; organizationId: string };
type User = { id: string; email: string; displayName: string };

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

  const orgWorkspaces = useMemo(
    () => workspaces.filter((workspace) => workspace.organizationId === organizationId),
    [workspaces, organizationId],
  );

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
      setName('');
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

  function toggleScope(scope: string) {
    setScopes((current) =>
      current.includes(scope)
        ? current.filter((item) => item !== scope)
        : [...current, scope],
    );
  }

  function toggleWorkspace(workspaceId: string) {
    setAllowedWorkspaceIds((current) =>
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

      <Panel>
        <h2 className="mt-0 mb-4 text-lg font-semibold">{t('createClient')}</h2>
        <div className="grid gap-4">
          <Field label={tCommon('name')}>
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
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
                    onChange={() => toggleScope(scope)}
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
                      onChange={() => toggleWorkspace(workspace.id)}
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
          <Button
            type="button"
            disabled={pending || !name || !organizationId}
            onClick={() => void createClient()}
          >
            {t('create')}
          </Button>
        </div>
      </Panel>

      <div className="grid gap-3">
        {initialClients.length === 0 ? (
          <p className="kh-muted">{t('emptyClients')}</p>
        ) : (
          initialClients.map((client) => (
            <Panel key={client.id} className="grid gap-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="m-0 text-base font-semibold">{client.name}</h3>
                  <p className="mt-1 mb-0 text-sm text-ink-muted">
                    {t('tokenPrefix')}: <span className="font-mono">{client.tokenPrefix}</span>
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
      </div>
    </div>
  );
}
