'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  Badge,
  Button,
  ErrorText,
  Modal,
  Panel,
  useToast,
} from './ui';
import { UserMcpSetupWizard } from './mcp-setup';
import { MCP_READ_SCOPES } from './mcp-setup/scopes';

export type MyApiClient = {
  id: string;
  name: string;
  description: string | null;
  tokenPrefix: string | null;
  scopes: string[];
  allowedWorkspaceIds: string[];
  status: string;
  agentLabel: string | null;
  createdAt: string;
  lastUsedAt: string | null;
};

type WorkspaceOption = { id: string; name: string; slug: string };

export function AiConnectionsPanel({
  initialClients,
  workspaces,
}: {
  initialClients: MyApiClient[];
  workspaces: WorkspaceOption[];
}) {
  const t = useTranslations('aiConnections');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const { pushToast } = useToast();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [pairingExpiresAt, setPairingExpiresAt] = useState<string | null>(null);
  const [discoverUrl, setDiscoverUrl] = useState<string | null>(null);
  const [apiDiscoverUrl, setApiDiscoverUrl] = useState<string | null>(null);

  const [approveClient, setApproveClient] = useState<MyApiClient | null>(null);
  const [approveScopes, setApproveScopes] = useState<string[]>([...MCP_READ_SCOPES]);
  const [approveWorkspaces, setApproveWorkspaces] = useState<string[]>([]);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  const [issuedClientName, setIssuedClientName] = useState<string | null>(null);

  const pendingClients = useMemo(
    () => initialClients.filter((client) => client.status === 'pending_approval'),
    [initialClients],
  );
  const activeClients = useMemo(
    () =>
      initialClients.filter(
        (client) => client.status === 'active' || client.status === 'rejected',
      ),
    [initialClients],
  );

  async function mintPairingCode() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/v1/me/ai-pairing-codes', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Origin: window.location.origin,
        },
        body: '{}',
      });
      const payload = (await response.json()) as {
        code?: string;
        expiresAt?: string;
        discoverUrl?: string;
        apiDiscoverUrl?: string;
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? t('pairingFailed'));
      }
      setPairingCode(payload.code ?? null);
      setPairingExpiresAt(payload.expiresAt ?? null);
      setDiscoverUrl(payload.discoverUrl ?? null);
      setApiDiscoverUrl(payload.apiDiscoverUrl ?? null);
      pushToast(t('pairingCreated'));
    } catch (err) {
      const message = err instanceof Error ? err.message : t('pairingFailed');
      setError(message);
      pushToast(message, 'danger');
    } finally {
      setPending(false);
    }
  }

  async function copyText(value: string, toastKey: 'copiedCode' | 'copiedUrl') {
    try {
      await navigator.clipboard.writeText(value);
      pushToast(t(toastKey));
    } catch {
      pushToast(t('copyFailed'), 'danger');
    }
  }

  function openApprove(client: MyApiClient) {
    setApproveClient(client);
    setApproveScopes(
      client.scopes.length > 0 ? [...client.scopes] : [...MCP_READ_SCOPES],
    );
    setApproveWorkspaces([...client.allowedWorkspaceIds]);
    setApproveError(null);
  }

  async function approvePending() {
    if (!approveClient) return;
    setPending(true);
    setApproveError(null);
    try {
      const response = await fetch(
        `/api/v1/me/api-clients/${approveClient.id}/approve`,
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
        apiClient?: { name?: string };
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? t('approveFailed'));
      }
      setIssuedToken(payload.token ?? null);
      setIssuedClientName(payload.apiClient?.name ?? approveClient?.name ?? null);
      setApproveClient(null);
      pushToast(t('toastApproved'));
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : t('approveFailed');
      setApproveError(message);
      pushToast(message, 'danger');
    } finally {
      setPending(false);
    }
  }

  async function rejectPending(clientId: string) {
    setPending(true);
    try {
      const response = await fetch(`/api/v1/me/api-clients/${clientId}/reject`, {
        method: 'POST',
        credentials: 'include',
        headers: { Origin: window.location.origin },
      });
      const payload = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? t('rejectFailed'));
      }
      pushToast(t('toastRejected'));
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : t('rejectFailed');
      pushToast(message, 'danger');
    } finally {
      setPending(false);
    }
  }

  async function revokeClient(clientId: string) {
    setPending(true);
    try {
      const response = await fetch(`/api/v1/me/api-clients/${clientId}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { Origin: window.location.origin },
      });
      const payload = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? t('revokeFailed'));
      }
      pushToast(t('toastRevoked'));
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : t('revokeFailed');
      pushToast(message, 'danger');
    } finally {
      setPending(false);
    }
  }

  function toggleScope(scope: string) {
    setApproveScopes((current) =>
      current.includes(scope)
        ? current.filter((item) => item !== scope)
        : [...current, scope],
    );
  }

  function toggleWorkspace(workspaceId: string) {
    setApproveWorkspaces((current) =>
      current.includes(workspaceId)
        ? current.filter((item) => item !== workspaceId)
        : [...current, workspaceId],
    );
  }

  return (
    <div className="grid gap-8">
      <UserMcpSetupWizard
        workspaces={workspaces}
        initialToken={issuedToken}
        initialClientName={issuedClientName}
        onTokenIssued={() => {
          setIssuedToken(null);
          setIssuedClientName(null);
        }}
      />

      <div className="grid gap-6">
        <div>
          <h2 className="m-0 text-base font-semibold">{t('pairingSectionTitle')}</h2>
          <p className="mt-1 mb-0 text-sm text-ink-muted">{t('pairingSectionBlurb')}</p>
        </div>

      {issuedToken ? (
        <Panel className="border-accent/30 bg-accent-soft/40">
          <p className="mt-0 mb-2 text-sm font-medium text-accent">{t('tokenOnce')}</p>
          <code className="block break-all rounded-md bg-panel-solid px-3 py-2 font-mono text-sm">
            {issuedToken}
          </code>
          <p className="mt-2 mb-0 text-xs text-ink-muted">{t('tokenOnceHint')}</p>
          <p className="mt-2 mb-0 text-xs text-ink-muted">{t('tokenWizardHint')}</p>
        </Panel>
      ) : null}

      <Panel className="grid gap-3">
        <h2 className="m-0 text-base font-semibold">{t('pairingTitle')}</h2>
        <p className="m-0 text-sm text-ink-muted">{t('pairingBlurb')}</p>
        <div>
          <Button type="button" disabled={pending} onClick={() => void mintPairingCode()}>
            {t('generateCode')}
          </Button>
        </div>
        {pairingCode ? (
          <Panel variant="inset" className="grid gap-2">
            <p className="m-0 text-sm font-medium">{t('yourCode')}</p>
            <code className="block break-all font-mono text-lg tracking-wider">
              {pairingCode}
            </code>
            {pairingExpiresAt ? (
              <p className="m-0 text-xs text-ink-muted">
                {t('expiresAt', {
                  time: new Date(pairingExpiresAt).toLocaleString(),
                })}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => void copyText(pairingCode, 'copiedCode')}
              >
                {t('copyCode')}
              </Button>
              {discoverUrl ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void copyText(discoverUrl, 'copiedUrl')}
                >
                  {t('copyDiscoverUrl')}
                </Button>
              ) : null}
            </div>
            {discoverUrl ? (
              <p className="m-0 text-xs text-ink-muted">
                {t('pasteHint', { url: discoverUrl })}
              </p>
            ) : null}
            {apiDiscoverUrl ? (
              <p className="m-0 text-xs text-ink-muted">
                {t('apiDiscoverHint', { url: apiDiscoverUrl })}
              </p>
            ) : null}
          </Panel>
        ) : null}
        {error ? <ErrorText>{error}</ErrorText> : null}
      </Panel>

      <section className="grid gap-3">
        <h2 className="m-0 text-base font-semibold">{t('pendingTitle')}</h2>
        {pendingClients.length === 0 ? (
          <p className="kh-muted m-0">{t('emptyPending')}</p>
        ) : (
          pendingClients.map((client) => (
            <Panel key={client.id} className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <strong>{client.name}</strong>
                  <Badge tone="brand">{t('statusPending')}</Badge>
                  {client.agentLabel ? (
                    <Badge tone="neutral">{client.agentLabel}</Badge>
                  ) : null}
                </div>
                <p className="mt-1 mb-0 font-mono text-xs text-ink-muted">
                  {client.scopes.join(', ')}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  disabled={pending}
                  onClick={() => openApprove(client)}
                >
                  {t('approve')}
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  disabled={pending}
                  onClick={() => void rejectPending(client.id)}
                >
                  {t('reject')}
                </Button>
              </div>
            </Panel>
          ))
        )}
      </section>

      <section className="grid gap-3">
        <h2 className="m-0 text-base font-semibold">{t('activeTitle')}</h2>
        {activeClients.length === 0 ? (
          <p className="kh-muted m-0">{t('emptyActive')}</p>
        ) : (
          activeClients.map((client) => (
            <Panel key={client.id} className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <strong>{client.name}</strong>
                  <Badge tone={client.status === 'active' ? 'success' : 'danger'}>
                    {client.status === 'active'
                      ? t('statusActive')
                      : t('statusRejected')}
                  </Badge>
                </div>
                {client.tokenPrefix ? (
                  <p className="mt-1 mb-0 text-sm text-ink-muted">
                    {t('tokenPrefix')}:{' '}
                    <span className="font-mono">{client.tokenPrefix}</span>
                  </p>
                ) : null}
                <p className="mt-1 mb-0 font-mono text-xs text-ink-muted">
                  {client.scopes.join(', ')}
                </p>
              </div>
              {client.status === 'active' ? (
                <Button
                  type="button"
                  variant="danger"
                  disabled={pending}
                  onClick={() => void revokeClient(client.id)}
                >
                  {t('revoke')}
                </Button>
              ) : null}
            </Panel>
          ))
        )}
      </section>

      <Modal
        open={approveClient != null}
        onClose={() => setApproveClient(null)}
        title={t('approveTitle')}
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
              {t('approveConfirm')}
            </Button>
          </>
        }
      >
        {approveClient ? (
          <div className="grid gap-3">
            <p className="m-0 text-sm text-ink-muted">{t('approveHint')}</p>
            <fieldset className="m-0 grid gap-2 border-0 p-0">
              <legend className="mb-1 text-sm font-medium">{t('scopes')}</legend>
              {[...MCP_READ_SCOPES, 'knowledge:write'].map((scope) => (
                <label key={scope} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={approveScopes.includes(scope)}
                    onChange={() => toggleScope(scope)}
                  />
                  <span className="font-mono text-xs">{scope}</span>
                </label>
              ))}
            </fieldset>
            <fieldset className="m-0 grid gap-2 border-0 p-0">
              <legend className="mb-1 text-sm font-medium">{t('workspaces')}</legend>
              <div className="grid max-h-40 gap-2 overflow-auto rounded-md border border-line p-3">
                {workspaces.length === 0 ? (
                  <p className="m-0 text-sm text-ink-muted">{t('noWorkspaces')}</p>
                ) : (
                  workspaces.map((workspace) => (
                    <label key={workspace.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={approveWorkspaces.includes(workspace.id)}
                        onChange={() => toggleWorkspace(workspace.id)}
                      />
                      {workspace.name}
                    </label>
                  ))
                )}
              </div>
              {approveScopes.includes('knowledge:write') ? (
                <p className="m-0 text-xs text-ink-muted">{t('writeNeedsWorkspace')}</p>
              ) : null}
            </fieldset>
            {approveError ? <ErrorText>{approveError}</ErrorText> : null}
          </div>
        ) : null}
      </Modal>
      </div>
    </div>
  );
}
