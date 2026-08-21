'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  Badge,
  Button,
  ErrorText,
  Modal,
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
        <section className="kh-ops-panel">
          <div className="kh-ops-card-body grid gap-2">
            <p className="m-0 text-sm font-medium text-accent">{t('tokenOnce')}</p>
            <code className="kh-ops-code">{issuedToken}</code>
            <p className="m-0 text-xs text-ink-muted">{t('tokenOnceHint')}</p>
            <p className="m-0 text-xs text-ink-muted">{t('tokenWizardHint')}</p>
          </div>
        </section>
      ) : null}

      <section className="kh-ops-panel">
        <div className="kh-ops-panel-head">
          <h2 className="kh-ops-panel-title">{t('pairingTitle')}</h2>
        </div>
        <div className="kh-ops-card-body grid gap-3">
          <p className="m-0 text-sm text-ink-muted">{t('pairingBlurb')}</p>
          {pairingCode ? (
            <div className="grid gap-2 border border-line p-3">
              <p className="m-0 text-sm font-medium">{t('yourCode')}</p>
              <code className="kh-ops-code text-lg tracking-wider">{pairingCode}</code>
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
            </div>
          ) : null}
          {error ? <ErrorText>{error}</ErrorText> : null}
        </div>
        <div className="kh-ops-action-line">
          <span className="kh-ops-panel-meta">{t('pairingTitle')}</span>
          <Button type="button" disabled={pending} onClick={() => void mintPairingCode()}>
            {t('generateCode')}
          </Button>
        </div>
      </section>

      <section className="kh-ops-panel">
        <div className="kh-ops-panel-head">
          <h2 className="kh-ops-panel-title">{t('pendingTitle')}</h2>
        </div>
        {pendingClients.length === 0 ? (
          <p className="kh-ops-empty">{t('emptyPending')}</p>
        ) : (
          <div className="kh-ops-table-wrap">
            <table className="kh-ops-data-table">
              <thead>
                <tr>
                  <th>{tCommon('name')}</th>
                  <th>{tCommon('status')}</th>
                  <th>{t('scopes')}</th>
                  <th>{t('colActions')}</th>
                </tr>
              </thead>
              <tbody>
                {pendingClients.map((client) => (
                  <tr key={client.id}>
                    <td className="kh-ops-primary-cell">
                      {client.name}
                      {client.agentLabel ? (
                        <div className="text-[11px] font-normal text-ink-muted">
                          {client.agentLabel}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <Badge tone="brand">{t('statusPending')}</Badge>
                    </td>
                    <td className="font-mono text-[11px]">{client.scopes.join(', ')}</td>
                    <td>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="kh-ops-text-btn"
                          disabled={pending}
                          onClick={() => openApprove(client)}
                        >
                          {t('approve')}
                        </button>
                        <button
                          type="button"
                          className="kh-ops-text-btn"
                          disabled={pending}
                          onClick={() => void rejectPending(client.id)}
                        >
                          {t('reject')}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="kh-ops-panel">
        <div className="kh-ops-panel-head">
          <h2 className="kh-ops-panel-title">{t('activeTitle')}</h2>
        </div>
        {activeClients.length === 0 ? (
          <p className="kh-ops-empty">{t('emptyActive')}</p>
        ) : (
          <div className="kh-ops-table-wrap">
            <table className="kh-ops-data-table">
              <thead>
                <tr>
                  <th>{tCommon('name')}</th>
                  <th>{tCommon('status')}</th>
                  <th>{t('scopes')}</th>
                  <th>{t('colActions')}</th>
                </tr>
              </thead>
              <tbody>
                {activeClients.map((client) => (
                  <tr key={client.id}>
                    <td className="kh-ops-primary-cell">
                      {client.name}
                      {client.tokenPrefix ? (
                        <div className="text-[11px] font-normal text-ink-muted">
                          {t('tokenPrefix')}: {client.tokenPrefix}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <Badge tone={client.status === 'active' ? 'success' : 'danger'}>
                        {client.status === 'active'
                          ? t('statusActive')
                          : t('statusRejected')}
                      </Badge>
                    </td>
                    <td className="font-mono text-[11px]">{client.scopes.join(', ')}</td>
                    <td>
                      {client.status === 'active' ? (
                        <button
                          type="button"
                          className="kh-ops-text-btn"
                          disabled={pending}
                          onClick={() => void revokeClient(client.id)}
                        >
                          {t('revoke')}
                        </button>
                      ) : (
                        tCommon('emDash')
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
              <div className="kh-ops-scope-checks">
                {[
                  ...MCP_READ_SCOPES,
                  'knowledge:write',
                  'catalogue:write',
                  'pm:read',
                  'pm:write',
                ].map((scope) => (
                  <label key={scope} className="kh-ops-scope-check">
                    <input
                      type="checkbox"
                      checked={approveScopes.includes(scope)}
                      onChange={() => toggleScope(scope)}
                    />
                    <span>{scope}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset className="m-0 grid gap-2 border-0 p-0">
              <legend className="mb-1 text-sm font-medium">{t('workspaces')}</legend>
              <div className="kh-ops-scope-checks max-h-40 overflow-auto">
                {workspaces.length === 0 ? (
                  <p className="m-0 text-sm text-ink-muted">{t('noWorkspaces')}</p>
                ) : (
                  workspaces.map((workspace) => (
                    <label key={workspace.id} className="kh-ops-scope-check">
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
              {approveScopes.includes('knowledge:write') ||
              approveScopes.includes('catalogue:write') ||
              approveScopes.includes('pm:write') ? (
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
